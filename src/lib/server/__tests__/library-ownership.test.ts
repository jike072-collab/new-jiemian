import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "library-owner-data-"));
process.env.UPLOADS_DIR = mkdtempSync(join(tmpdir(), "library-owner-uploads-"));
process.env.RUNTIME_STORAGE_ISOLATION = "";
process.env.LIBRARY_STORAGE_BACKEND = "json";
delete process.env.DATABASE_LIBRARY_READ_ENABLED;
delete process.env.DATABASE_LIBRARY_DUAL_WRITE;

const libraryModule = import("../library.js");

after(async () => {
  await Promise.all([
    rm(process.env.DATA_DIR!, { recursive: true, force: true }),
    rm(process.env.UPLOADS_DIR!, { recursive: true, force: true }),
  ]);
});

async function addOwnedImage(id: string, ownerLocalUserId: string | null, contents: string) {
  const { addLibraryItem, storeBytes } = await libraryModule;
  const output = await storeBytes(Buffer.from(contents), "image/png", id);
  const item = await addLibraryItem({
    ownerLocalUserId,
    type: "image",
    mode: "text-to-image",
    title: id,
    prompt: id,
    providerId: "provider",
    model: "model",
    status: "done",
    output,
    params: {},
  });
  return item;
}

test("JSON library reads only the current user's owned works", async () => {
  const { readLibrary } = await libraryModule;
  const userA = await addOwnedImage("user-a", "user-a", "a");
  await addOwnedImage("user-b", "user-b", "b");
  await addOwnedImage("legacy", null, "legacy");

  const items = await readLibrary("user-a");

  assert.deepEqual(items.map((item) => item.id), [userA.id]);
});

test("JSON library delete rejects another user's or legacy unowned work", async () => {
  const { deleteLibraryItem, LibraryOperationError } = await libraryModule;
  const userB = await addOwnedImage("delete-user-b", "user-b", "b");
  const legacy = await addOwnedImage("delete-legacy", null, "legacy");

  await assert.rejects(
    () => deleteLibraryItem(userB.id, "user-a"),
    (error: unknown) => error instanceof LibraryOperationError && error.status === 404,
  );
  await assert.rejects(
    () => deleteLibraryItem(legacy.id, "user-a"),
    (error: unknown) => error instanceof LibraryOperationError && error.status === 404,
  );
});

test("stored file reads require ownership through a library item", async () => {
  const { readOwnedStoredFile } = await libraryModule;
  const userA = await addOwnedImage("file-user-a", "user-a", "a");
  const userB = await addOwnedImage("file-user-b", "user-b", "b");
  const legacy = await addOwnedImage("file-legacy", null, "legacy");

  assert.equal((await readOwnedStoredFile(userA.output!.storedName!, "user-a"))?.toString(), "a");
  assert.equal(await readOwnedStoredFile(userB.output!.storedName!, "user-a"), null);
  assert.equal(await readOwnedStoredFile(legacy.output!.storedName!, "user-a"), null);
});
