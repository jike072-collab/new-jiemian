import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createMemoryNewApiUserMappingRepository,
  NewApiUserMappingError,
} from "../user-mapping";

test("creates pending mappings idempotently by local user id", async () => {
  const repository = createMemoryNewApiUserMappingRepository();

  const first = await repository.createPending({
    localUserId: "local-user-1",
    idempotencyKey: "register:local-user-1",
    now: new Date("2026-06-18T00:00:00.000Z"),
  });
  const second = await repository.createPending({
    localUserId: "local-user-1",
    idempotencyKey: "different-key",
  });

  assert.equal(first.local_user_id, "local-user-1");
  assert.equal(first.sync_status, "pending");
  assert.equal(second.idempotency_key, "register:local-user-1");
  assert.equal(second.version, 1);
});

test("activates a mapping and enforces unique New API user ids", async () => {
  const repository = createMemoryNewApiUserMappingRepository();
  await repository.createPending({ localUserId: "local-a" });
  await repository.createPending({ localUserId: "local-b" });

  const active = await repository.markActive({
    localUserId: "local-a",
    newApiUserId: 101,
    expectedVersion: 1,
  });

  assert.equal(active.sync_status, "active");
  assert.equal(active.new_api_user_id, "101");
  assert.equal(active.version, 2);

  await assert.rejects(
    () => repository.markActive({
      localUserId: "local-b",
      newApiUserId: "101",
      expectedVersion: 1,
    }),
    (error) => error instanceof NewApiUserMappingError
      && error.code === "NEW_API_MAPPING_CONFLICT",
  );
});

test("uses optimistic versions to stop stale concurrent transitions", async () => {
  const repository = createMemoryNewApiUserMappingRepository();
  await repository.createPending({ localUserId: "local-user" });
  await repository.markFailed({
    localUserId: "local-user",
    code: "NEW_API_TIMEOUT",
    message: "request timed out",
    retryable: true,
    expectedVersion: 1,
  });

  await assert.rejects(
    () => repository.markActive({
      localUserId: "local-user",
      newApiUserId: 99,
      expectedVersion: 1,
    }),
    (error) => error instanceof NewApiUserMappingError
      && error.code === "NEW_API_MAPPING_VERSION_CONFLICT",
  );
});

test("marks retryable failures, exhausts retries, and redacts secrets", async () => {
  const repository = createMemoryNewApiUserMappingRepository();
  await repository.createPending({ localUserId: "local-user" });

  const failed = await repository.markFailed({
    localUserId: "local-user",
    code: "NEW_API_NETWORK",
    message: "Authorization=Bearer secret-token password=hidden",
    retryable: true,
    maxRetryCount: 2,
  });

  assert.equal(failed.sync_status, "failed");
  assert.equal(failed.retry_count, 1);
  assert.equal(failed.last_error_message?.includes("secret-token"), false);
  assert.equal(failed.last_error_message?.includes("hidden"), false);

  const repair = await repository.markFailed({
    localUserId: "local-user",
    code: "NEW_API_NETWORK",
    message: "network failed again",
    retryable: true,
    maxRetryCount: 2,
    expectedVersion: failed.version,
  });

  assert.equal(repair.sync_status, "repair_required");
  assert.equal(repair.retry_count, 2);
});

test("prepares failed mappings for retry but blocks exhausted repair state", async () => {
  const repository = createMemoryNewApiUserMappingRepository();
  await repository.createPending({ localUserId: "local-user" });
  const failed = await repository.markFailed({
    localUserId: "local-user",
    code: "NEW_API_TIMEOUT",
    message: "timeout",
    retryable: true,
    maxRetryCount: 3,
  });

  const retry = await repository.prepareRetry({
    localUserId: "local-user",
    expectedVersion: failed.version,
    maxRetryCount: 3,
  });
  assert.equal(retry.sync_status, "pending");
  assert.equal(retry.last_error_code, null);

  const repair = await repository.scheduleRepair({
    localUserId: "local-user",
    code: "CONFLICT",
    message: "manual review required",
    expectedVersion: retry.version,
  });
  await assert.rejects(
    () => repository.prepareRetry({ localUserId: "local-user", expectedVersion: repair.version }),
    (error) => error instanceof NewApiUserMappingError
      && error.code === "NEW_API_MAPPING_RETRY_EXHAUSTED",
  );
});

test("serializes concurrent create attempts into one mapping", async () => {
  const repository = createMemoryNewApiUserMappingRepository();
  const results = await Promise.all(Array.from({ length: 20 }, (_, index) => (
    repository.createPending({
      localUserId: "same-local-user",
      idempotencyKey: `attempt-${index}`,
    })
  )));

  assert.equal(new Set(results.map((record) => record.local_user_id)).size, 1);
  assert.equal(new Set(results.map((record) => record.idempotency_key)).size, 1);
  assert.equal((await repository.listByStatus("pending")).length, 1);
});

test("supports disable, orphan, and repair transitions", async () => {
  const repository = createMemoryNewApiUserMappingRepository();
  await repository.createPending({ localUserId: "local-user" });
  const active = await repository.markActive({ localUserId: "local-user", newApiUserId: "200" });
  const disabled = await repository.markDisabled({
    localUserId: "local-user",
    expectedVersion: active.version,
    code: "LOCAL_DISABLED",
    message: "local account disabled",
  });
  const orphaned = await repository.markOrphaned({
    localUserId: "local-user",
    expectedVersion: disabled.version,
    code: "LOCAL_MISSING",
    message: "local owner missing",
  });
  const repair = await repository.scheduleRepair({
    localUserId: "local-user",
    expectedVersion: orphaned.version,
    code: "MANUAL_REVIEW",
    message: "needs operator review",
  });

  assert.equal(disabled.sync_status, "disabled");
  assert.equal(orphaned.sync_status, "orphaned");
  assert.equal(repair.sync_status, "repair_required");
  assert.equal((await repository.getByNewApiUserId("200"))?.local_user_id, "local-user");
});
