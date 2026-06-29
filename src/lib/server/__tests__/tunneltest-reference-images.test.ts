import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "tunneltest-reference-data-"));
process.env.UPLOADS_DIR = mkdtempSync(join(tmpdir(), "tunneltest-reference-uploads-"));
process.env.PORT = "3107";
process.env.RUNTIME_STORAGE_ISOLATION = "strict";
process.env.TEST_INVITE_CODE = "reference-secret";

const referenceModule = import("../tunneltest-reference-images.js");

after(async () => {
  await Promise.all([
    rm(process.env.DATA_DIR!, { recursive: true, force: true }),
    rm(process.env.UPLOADS_DIR!, { recursive: true, force: true }),
  ]);
});

test("tunneltest reference images require a signed short-test URL", async () => {
  const { createTunneltestReferenceImageUrl, readTunneltestReferenceImage } = await referenceModule;
  const url = await createTunneltestReferenceImageUrl({
    baseUrl: "https://short-test.example",
    bytes: Buffer.from("reference"),
    mimeType: "image/png",
  });

  assert.match(url, /^https:\/\/short-test\.example\/api\/tunneltest\/reference-images\/video-reference-/);

  const parsed = new URL(url);
  const storedName = decodeURIComponent(parsed.pathname.split("/").pop() || "");
  const signed = await readTunneltestReferenceImage(storedName, parsed.searchParams.get("sig"));
  assert.equal(signed?.bytes.toString(), "reference");
  assert.equal(signed?.mimeType, "image/png");

  assert.equal(await readTunneltestReferenceImage(storedName, "bad-signature"), null);

  delete process.env.TEST_INVITE_CODE;
  assert.equal(await readTunneltestReferenceImage(storedName, parsed.searchParams.get("sig")), null);
});
