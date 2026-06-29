import assert from "node:assert/strict";
import { test } from "node:test";

import {
  executeLibraryShadowWrite,
  libraryShadowWriteIdempotencyKey,
  scheduleLibraryShadowWrite,
} from "../library-shadow-write";
import { type Stage9cbLibraryDatabaseAdapter } from "../library-jobs-adapter";
import { type LibraryItem } from "../../types";

const now = "2026-06-29T00:00:00.000Z";

function libraryItem(overrides: Partial<LibraryItem> = {}): LibraryItem {
  return {
    id: "library-1",
    type: "image",
    mode: "text-to-image",
    title: "Prompt",
    prompt: "safe prompt",
    providerId: "provider-1",
    model: "model-1",
    status: "done",
    createdAt: now,
    updatedAt: now,
    output: {
      url: "/api/files/result.png",
      storedName: "result.png",
      mimeType: "image/png",
      size: 123,
    },
    params: { width: 512 },
    ...overrides,
  };
}

function createAdapter(overrides: Partial<Stage9cbLibraryDatabaseAdapter> = {}) {
  const calls: string[] = [];
  const adapter: Stage9cbLibraryDatabaseAdapter = {
    async readLibrary() {
      calls.push("readLibrary");
      return [];
    },
    async addLibraryItem() {
      calls.push("addLibraryItem");
      return libraryItem();
    },
    async updateLibraryItem() {
      calls.push("updateLibraryItem");
      return libraryItem();
    },
    async softDeleteLibraryItem() {
      calls.push("softDeleteLibraryItem");
      return { deleted: true };
    },
    async readJobs() {
      calls.push("readJobs");
      return [];
    },
    async addJob(job) {
      calls.push("addJob");
      return job;
    },
    async updateJob(job) {
      calls.push("updateJob");
      return job;
    },
    ...overrides,
  };
  return { adapter, calls };
}

test("library shadow write uses stable library idempotency keys", () => {
  const item = libraryItem();

  assert.equal(
    libraryShadowWriteIdempotencyKey({ operation: "addLibraryItem", item }),
    "library:library-1:add",
  );
  assert.equal(
    libraryShadowWriteIdempotencyKey({
      operation: "updateLibraryItem",
      id: item.id,
      patch: { status: "done" },
      nextItem: item,
    }),
    "library:library-1:update",
  );
  assert.equal(
    libraryShadowWriteIdempotencyKey({ operation: "softDeleteLibraryItem", id: item.id }),
    "library:library-1:soft-delete",
  );
});

test("library shadow write calls only the database adapter", async () => {
  const { adapter, calls } = createAdapter();
  const status = await executeLibraryShadowWrite(
    { operation: "addLibraryItem", item: libraryItem() },
    { adapter },
  );

  assert.deepEqual(status, {
    ok: true,
    operation: "addLibraryItem",
    idempotencyKey: "library:library-1:add",
  });
  assert.deepEqual(calls, ["addLibraryItem"]);
});

test("library shadow write timeout is isolated from the caller", async () => {
  const { adapter } = createAdapter({
    async updateLibraryItem() {
      await new Promise(() => undefined);
      return null;
    },
  });

  const status = await executeLibraryShadowWrite(
    {
      operation: "updateLibraryItem",
      id: "library-1",
      patch: { status: "failed" },
      nextItem: libraryItem({ status: "failed" }),
    },
    { adapter, timeoutMs: 1 },
  );

  assert.equal(status.ok, false);
  assert.equal(status.operation, "updateLibraryItem");
  assert.equal(status.idempotencyKey, "library:library-1:update");
  assert.equal(status.failureCategory, "timeout");
  assert.equal(status.errorName, "LibraryShadowWriteTimeoutError");
});

test("scheduled library shadow write logs only safe failure metadata", async () => {
  const sensitiveValue = "stage9e-sensitive-shadow-write-value";
  const { adapter } = createAdapter({
    async softDeleteLibraryItem() {
      throw new Error(`could not connect to ${sensitiveValue}`);
    },
  });
  const warnings: unknown[] = [];
  const logger = {
    warn: (...args: unknown[]) => {
      warnings.push(args);
    },
  };

  const status = await scheduleLibraryShadowWrite(
    { operation: "softDeleteLibraryItem", id: "library-1" },
    { adapter, logger },
  );

  const output = JSON.stringify({ status, warnings });
  assert.equal(status.ok, false);
  assert.equal(warnings.length, 1);
  assert.equal(output.includes(sensitiveValue), false);
  assert.equal(output.includes("library:library-1:soft-delete"), true);
});
