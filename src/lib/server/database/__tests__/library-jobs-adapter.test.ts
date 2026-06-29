import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DatabaseMvpRepositoryError,
  type DatabaseMvpAsset,
  type DatabaseMvpGenerationJob,
  type DatabaseMvpLibraryItem,
} from "../mvp-repositories";
import { createStage9cbLibraryDatabaseAdapter, type Stage9cbDatabaseRepository } from "../library-jobs-adapter";
import { type JobRecord, type LibraryItem } from "../../types";

const now = "2026-06-28T00:00:00.000Z";
const later = "2026-06-28T00:01:00.000Z";

function createMemoryRepository() {
  const assets = new Map<string, DatabaseMvpAsset>();
  const jobs = new Map<string, DatabaseMvpGenerationJob>();
  const libraryItems = new Map<string, DatabaseMvpLibraryItem>();
  const calls: string[] = [];

  const repository: Stage9cbDatabaseRepository = {
    async createAsset(input) {
      calls.push("createAsset");
      const asset: DatabaseMvpAsset = {
        id: input.id || `asset-${assets.size + 1}`,
        kind: input.kind,
        storage_type: input.storage_type,
        path_or_url: input.path_or_url,
        mime_type: input.mime_type ?? null,
        size_bytes: input.size_bytes ?? null,
        sha256: input.sha256 ?? null,
        width: input.width ?? null,
        height: input.height ?? null,
        duration_ms: input.duration_ms ?? null,
        created_at: String(input.created_at || now),
        deleted_at: input.deleted_at ? String(input.deleted_at) : null,
      };
      assets.set(asset.id, asset);
      return asset;
    },
    async getAsset(id) {
      calls.push("getAsset");
      return assets.get(id) || null;
    },
    async createGenerationJob(input) {
      calls.push("createGenerationJob");
      const createdAt = String(input.created_at || now);
      const job: DatabaseMvpGenerationJob = {
        id: input.id || `job-${jobs.size + 1}`,
        user_id: input.user_id ?? null,
        kind: input.kind,
        status: input.status || "queued",
        prompt: input.prompt,
        input_asset_id: input.input_asset_id ?? null,
        output_asset_id: input.output_asset_id ?? null,
        provider: input.provider ?? null,
        provider_model: input.provider_model ?? null,
        request_hash: input.request_hash ?? null,
        error_code: input.error_code ?? null,
        user_visible_error: input.user_visible_error ?? null,
        internal_error_masked: input.internal_error_masked ?? null,
        created_at: createdAt,
        updated_at: String(input.updated_at || createdAt),
        started_at: input.started_at ? String(input.started_at) : null,
        completed_at: input.completed_at ? String(input.completed_at) : null,
      };
      jobs.set(job.id, job);
      return job;
    },
    async getGenerationJob(id) {
      calls.push("getGenerationJob");
      return jobs.get(id) || null;
    },
    async updateGenerationJob(id, patch) {
      calls.push("updateGenerationJob");
      const current = jobs.get(id);
      if (!current) throw new DatabaseMvpRepositoryError("DATABASE_MVP_NOT_FOUND", "missing job");
      const next = {
        ...current,
        ...patch,
        updated_at: String(patch.updated_at || later),
        started_at: patch.started_at === undefined ? current.started_at : patch.started_at ? String(patch.started_at) : null,
        completed_at: patch.completed_at === undefined ? current.completed_at : patch.completed_at ? String(patch.completed_at) : null,
      };
      jobs.set(id, next);
      return next;
    },
    async listGenerationJobs(filter = {}) {
      calls.push("listGenerationJobs");
      return [...jobs.values()]
        .filter((job) => !filter.kind || job.kind === filter.kind)
        .filter((job) => !filter.status || job.status === filter.status)
        .slice(0, filter.limit || 50);
    },
    async createLibraryItem(input) {
      calls.push("createLibraryItem");
      const createdAt = String(input.created_at || now);
      const item: DatabaseMvpLibraryItem = {
        id: input.id || `library-${libraryItems.size + 1}`,
        asset_id: input.asset_id,
        generation_job_id: input.generation_job_id ?? null,
        user_id: input.user_id ?? null,
        title: input.title ?? null,
        kind: input.kind,
        source: input.source,
        is_deleted: Boolean(input.is_deleted),
        created_at: createdAt,
        updated_at: String(input.updated_at || createdAt),
        deleted_at: input.deleted_at ? String(input.deleted_at) : null,
      };
      libraryItems.set(item.id, item);
      return item;
    },
    async getLibraryItem(id) {
      calls.push("getLibraryItem");
      return libraryItems.get(id) || null;
    },
    async updateLibraryItem(id, patch) {
      calls.push("updateLibraryItem");
      const current = libraryItems.get(id);
      if (!current) throw new DatabaseMvpRepositoryError("DATABASE_MVP_NOT_FOUND", "missing library item");
      const next = {
        ...current,
        ...patch,
        updated_at: String(patch.updated_at || later),
        deleted_at: patch.deleted_at === undefined ? current.deleted_at : patch.deleted_at ? String(patch.deleted_at) : null,
      };
      libraryItems.set(id, next);
      return next;
    },
    async softDeleteLibraryItem(id, deletedAt = later) {
      calls.push("softDeleteLibraryItem");
      const current = libraryItems.get(id);
      if (!current) throw new DatabaseMvpRepositoryError("DATABASE_MVP_NOT_FOUND", "missing library item");
      const next = {
        ...current,
        is_deleted: true,
        deleted_at: String(deletedAt),
        updated_at: String(deletedAt),
      };
      libraryItems.set(id, next);
      return next;
    },
    async listLibraryItems(filter = {}) {
      calls.push("listLibraryItems");
      return [...libraryItems.values()]
        .filter((item) => filter.include_deleted || !item.is_deleted)
        .filter((item) => filter.user_id === undefined || item.user_id === filter.user_id)
        .slice(0, filter.limit || 50);
    },
  };

  return { assets, jobs, libraryItems, calls, repository };
}

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

function jobRecord(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: "provider-job-id",
    libraryItemId: "library-1",
    type: "video",
    ownerLocalUserId: "11111111-1111-4111-8111-111111111111",
    providerId: "provider-1",
    status: "generating",
    statusUrl: "https://provider.example/status/provider-job-id",
    sourceUrl: "https://provider.example/source.mp4",
    billing_task_id: null,
    billing_local_user_id: null,
    billing_idempotency_key: null,
    billing_estimated_quota_units: null,
    billing_state: null,
    billing_last_error: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

test("database library adapter writes assets and preserves library response shape", async () => {
  const memory = createMemoryRepository();
  const adapter = createStage9cbLibraryDatabaseAdapter(memory.repository);
  const item = libraryItem();

  await adapter.addLibraryItem(item);
  const [fromDb] = await adapter.readLibrary();

  assert.equal(memory.assets.size, 1);
  assert.equal(memory.libraryItems.size, 1);
  assert.equal(fromDb.id, item.id);
  assert.equal(fromDb.type, "image");
  assert.equal(fromDb.mode, "text-to-image");
  assert.equal(fromDb.output?.storedName, "result.png");
  assert.equal(fromDb.output?.url, "/api/files/result.png");
  assert.equal(fromDb.fileAvailable, true);
});

test("database library adapter repeats library writes with stable ids", async () => {
  const memory = createMemoryRepository();
  const adapter = createStage9cbLibraryDatabaseAdapter(memory.repository);

  await adapter.addLibraryItem(libraryItem());
  await adapter.addLibraryItem(libraryItem({ title: "Updated prompt", updatedAt: later }));

  assert.equal(memory.assets.size, 1);
  assert.equal(memory.libraryItems.size, 1);
  assert.equal(memory.libraryItems.get("library-1")?.title, "Updated prompt");
  assert.equal(memory.calls.filter((call) => call === "updateLibraryItem").length, 1);
});

test("database library adapter uses soft delete and does not remove files", async () => {
  const memory = createMemoryRepository();
  const adapter = createStage9cbLibraryDatabaseAdapter(memory.repository);

  await adapter.addLibraryItem(libraryItem());
  const result = await adapter.softDeleteLibraryItem("library-1");
  const rows = await memory.repository.listLibraryItems({ include_deleted: true });

  assert.deepEqual(result, { deleted: true });
  assert.equal(rows[0].is_deleted, true);
  assert.equal(rows[0].deleted_at, later);
  assert.equal(memory.calls.includes("softDeleteLibraryItem"), true);
});

test("database jobs adapter maps JSON job status to database status and back", async () => {
  const memory = createMemoryRepository();
  const adapter = createStage9cbLibraryDatabaseAdapter(memory.repository);

  await adapter.addLibraryItem(libraryItem({ type: "video", mode: "text-to-video", status: "generating", output: undefined }));
  await adapter.addJob(jobRecord());
  await adapter.updateJob(jobRecord({ status: "done", updatedAt: later, sourceUrl: "https://provider.example/output.mp4" }));
  const [job] = await adapter.readJobs();

  assert.equal(memory.jobs.size, 1);
  assert.equal([...memory.jobs.values()].some((row) => row.status === "succeeded"), true);
  assert.equal(job.id, "provider-job-id");
  assert.equal(job.status, "done");
  assert.equal(job.statusUrl, "");
  assert.equal(JSON.stringify([...memory.assets.values()]).includes("https://provider.example/status/provider-job-id"), false);
  assert.equal(JSON.stringify([...memory.assets.values()]).includes("https://provider.example/source.mp4"), false);
});

test("database library adapter returns false delete for missing records without a 500-style throw", async () => {
  const memory = createMemoryRepository();
  const adapter = createStage9cbLibraryDatabaseAdapter(memory.repository);

  const result = await adapter.softDeleteLibraryItem("missing");

  assert.deepEqual(result, { deleted: false });
});

test("database library adapter filters reads by owner and excludes unowned rows", async () => {
  const memory = createMemoryRepository();
  const adapter = createStage9cbLibraryDatabaseAdapter(memory.repository);

  await adapter.addLibraryItem(libraryItem({
    id: "owned-a",
    ownerLocalUserId: "user-a",
    output: { url: "/api/files/a.png", storedName: "a.png", mimeType: "image/png" },
  }));
  await adapter.addLibraryItem(libraryItem({
    id: "owned-b",
    ownerLocalUserId: "user-b",
    output: { url: "/api/files/b.png", storedName: "b.png", mimeType: "image/png" },
  }));
  await adapter.addLibraryItem(libraryItem({
    id: "legacy-unowned",
    ownerLocalUserId: null,
    output: { url: "/api/files/legacy.png", storedName: "legacy.png", mimeType: "image/png" },
  }));

  const userAItems = await adapter.readLibrary("user-a");

  assert.deepEqual(userAItems.map((item) => item.id), ["owned-a"]);
});

test("database library adapter refuses owner-scoped delete for another or unowned item", async () => {
  const memory = createMemoryRepository();
  const adapter = createStage9cbLibraryDatabaseAdapter(memory.repository);

  await adapter.addLibraryItem(libraryItem({ id: "owned-b", ownerLocalUserId: "user-b" }));
  await adapter.addLibraryItem(libraryItem({ id: "legacy-unowned", ownerLocalUserId: null }));

  assert.deepEqual(await adapter.softDeleteLibraryItem("owned-b", "user-a"), { deleted: false });
  assert.deepEqual(await adapter.softDeleteLibraryItem("legacy-unowned", "user-a"), { deleted: false });

  const rows = await memory.repository.listLibraryItems({ include_deleted: true });
  assert.equal(rows.find((item) => item.id === "owned-b")?.is_deleted, false);
  assert.equal(rows.find((item) => item.id === "legacy-unowned")?.is_deleted, false);
});
