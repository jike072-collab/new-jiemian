import assert from "node:assert/strict";
import { test } from "node:test";

import { type QueryResult, type QueryResultRow } from "pg";

import {
  createPostgresDatabaseMvpRepository,
  type DatabaseMvpQuery,
} from "../mvp-repositories";

type Call = {
  text: string;
  values: unknown[];
};

function result<T extends QueryResultRow>(row: T): QueryResult<T> {
  return {
    command: "SELECT",
    rowCount: 1,
    oid: 0,
    fields: [],
    rows: [row],
  };
}

function empty<T extends QueryResultRow>(): QueryResult<T> {
  return {
    command: "SELECT",
    rowCount: 0,
    oid: 0,
    fields: [],
    rows: [],
  };
}

function createMockQuery(rows: QueryResultRow[] = []) {
  const calls: Call[] = [];
  const queue = rows.slice();
  const query: DatabaseMvpQuery = async <T extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []) => {
    calls.push({ text, values });
    const row = queue.shift();
    return row ? result(row as T) : empty<T>();
  };
  return { calls, query };
}

const fixedDate = "2026-06-28T00:00:00.000Z";

test("creates generation assets and jobs without changing existing API surfaces", async () => {
  const { calls, query } = createMockQuery([
    {
      id: "asset-1",
      kind: "image",
      storage_type: "local",
      path_or_url: "uploads/example.png",
      mime_type: "image/png",
      size_bytes: "12",
      sha256: null,
      width: 100,
      height: 100,
      duration_ms: null,
      created_at: fixedDate,
      deleted_at: null,
    },
    {
      id: "job-1",
      user_id: null,
      kind: "image",
      status: "queued",
      prompt: "a prompt",
      input_asset_id: "asset-1",
      output_asset_id: null,
      provider: null,
      provider_model: null,
      request_hash: null,
      error_code: null,
      user_visible_error: null,
      internal_error_masked: null,
      created_at: fixedDate,
      updated_at: fixedDate,
      started_at: null,
      completed_at: null,
    },
  ]);
  const repository = createPostgresDatabaseMvpRepository(query);

  const asset = await repository.createAsset({
    id: "asset-1",
    kind: "image",
    storage_type: "local",
    path_or_url: "uploads/example.png",
    mime_type: "image/png",
    size_bytes: 12,
    sha256: null,
    width: 100,
    height: 100,
    duration_ms: null,
    created_at: fixedDate,
  });
  const job = await repository.createGenerationJob({
    id: "job-1",
    user_id: null,
    kind: "image",
    prompt: "a prompt",
    input_asset_id: asset.id,
    output_asset_id: null,
    provider: null,
    provider_model: null,
    request_hash: null,
    created_at: fixedDate,
  });

  assert.equal(asset.size_bytes, 12);
  assert.equal(job.status, "queued");
  assert.match(calls[0].text, /insert into assets/i);
  assert.match(calls[1].text, /insert into generation_jobs/i);
  assert.equal(calls.length, 2);
});

test("links library items to assets and generation jobs", async () => {
  const { calls, query } = createMockQuery([
    {
      id: "library-1",
      asset_id: "asset-1",
      generation_job_id: "job-1",
      user_id: null,
      title: "Result",
      kind: "image",
      source: "generation",
      is_deleted: false,
      created_at: fixedDate,
      updated_at: fixedDate,
      deleted_at: null,
    },
  ]);
  const repository = createPostgresDatabaseMvpRepository(query);

  const item = await repository.createLibraryItem({
    id: "library-1",
    asset_id: "asset-1",
    generation_job_id: "job-1",
    user_id: null,
    title: "Result",
    kind: "image",
    source: "generation",
    created_at: fixedDate,
  });

  assert.equal(item.asset_id, "asset-1");
  assert.equal(item.generation_job_id, "job-1");
  assert.equal(item.is_deleted, false);
  assert.match(calls[0].text, /insert into library_items/i);
});

test("redacts provider snapshots, api call errors, and error events before insert", async () => {
  const { calls, query } = createMockQuery([
    {
      id: "snapshot-1",
      provider: "provider",
      model_id: "model",
      display_name: "Model",
      capability: "image",
      raw_response_masked: { token: "[REDACTED]" },
      checked_at: fixedDate,
      created_at: fixedDate,
    },
    {
      id: "api-log-1",
      provider: "provider",
      endpoint_kind: "models",
      generation_job_id: null,
      status: "failed",
      latency_ms: 20,
      request_id: "req-1",
      error_code: "ERR",
      error_masked: "Bearer [REDACTED]",
      created_at: fixedDate,
    },
    {
      id: "error-1",
      scope: "database-mvp",
      severity: "error",
      code: "ERR",
      message_masked: "postgresql://[REDACTED]",
      context_masked: { apiKey: "[REDACTED]" },
      created_at: fixedDate,
    },
  ]);
  const repository = createPostgresDatabaseMvpRepository(query);

  await repository.appendProviderModelSnapshot({
    id: "snapshot-1",
    provider: "provider",
    model_id: "model",
    display_name: "Model",
    capability: "image",
    raw_response_masked: {
      token: "secret-token-value",
      url: "postgresql://user:password@127.0.0.1/app",
    },
    checked_at: fixedDate,
    created_at: fixedDate,
  });
  await repository.appendApiCallLog({
    id: "api-log-1",
    provider: "provider",
    endpoint_kind: "models",
    generation_job_id: null,
    status: "failed",
    latency_ms: 20,
    request_id: "req-1",
    error_code: "ERR",
    error_masked: "Authorization=Bearer live-secret-token",
    created_at: fixedDate,
  });
  await repository.appendErrorEvent({
    id: "error-1",
    scope: "database-mvp",
    severity: "error",
    code: "ERR",
    message_masked: "APP_DATABASE_URL=postgresql://user:password@127.0.0.1/app",
    context_masked: { apiKey: "sk-real-secret-token-1234567890" },
    created_at: fixedDate,
  });

  const serializedCalls = JSON.stringify(calls);
  assert.equal(serializedCalls.includes("secret-token-value"), false);
  assert.equal(serializedCalls.includes("live-secret-token"), false);
  assert.equal(serializedCalls.includes("sk-real-secret-token"), false);
  assert.equal(serializedCalls.includes("user:password"), false);
  assert.match(serializedCalls, /\[REDACTED\]/);
});

test("list methods apply bounded limits and safe filters", async () => {
  const { calls, query } = createMockQuery([
    {
      id: "job-1",
      user_id: "user-1",
      kind: "image",
      status: "queued",
      prompt: "prompt",
      input_asset_id: null,
      output_asset_id: null,
      provider: null,
      provider_model: null,
      request_hash: null,
      error_code: null,
      user_visible_error: null,
      internal_error_masked: null,
      created_at: fixedDate,
      updated_at: fixedDate,
      started_at: null,
      completed_at: null,
    },
  ]);
  const repository = createPostgresDatabaseMvpRepository(query);

  const jobs = await repository.listGenerationJobs({
    user_id: "user-1",
    status: "queued",
    kind: "image",
    limit: 999,
  });

  assert.equal(jobs.length, 1);
  assert.match(calls[0].text, /where user_id = \$1 and status = \$2 and kind = \$3/i);
  assert.equal(calls[0].values[3], 200);
});
