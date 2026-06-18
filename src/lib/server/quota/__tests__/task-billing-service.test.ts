import assert from "node:assert/strict";
import { test } from "node:test";

import { applicationQuery, closeApplicationDatabasePool } from "../../database";
import {
  createMemoryNewApiUserMappingRepository,
  type NewApiUserMapping,
} from "../../integrations/new-api";
import { createPostgresNewApiUserMappingRepository } from "../../integrations/new-api/postgres-user-mapping";
import { createMemoryUsageLogRepository } from "../repository";
import { QuotaDisplayCache } from "../cache";
import { createMemoryTaskBillingRepository, type TaskBillingRepository } from "../task-billing-repository";
import { createPostgresTaskBillingRepository } from "../postgres-task-billing-repository";
import { TaskBillingService, type AdjustQuotaInput } from "../task-billing-service";
import { type QuotaSnapshot } from "../types";

const hasDatabase = Boolean(process.env.APP_DATABASE_URL && process.env.APP_DATABASE_EXPECTED_NAME);
const dbTest = hasDatabase ? test : test.skip;

function mappingSeed(localUserId = "local-user", newApiUserId = "100"): NewApiUserMapping[] {
  const now = "2026-06-18T00:00:00.000Z";
  return [{
    local_user_id: localUserId,
    new_api_user_id: newApiUserId,
    sync_status: "active",
    created_at: now,
    updated_at: now,
    last_sync_at: now,
    last_error_code: null,
    last_error_message: null,
    retry_count: 0,
    version: 2,
    idempotency_key: `register:${localUserId}`,
  }];
}

function snapshot(available: number, localUserId = "local-user", newApiUserId = "100"): QuotaSnapshot {
  return {
    local_user_id: localUserId,
    new_api_user_id: newApiUserId,
    quota_units: available,
    used_quota_units: 0,
    available_quota_units: available,
    display_unit: "credits",
    source: "new_api",
    fetched_at: "2026-06-18T00:00:00.000Z",
    cached: false,
    cache_expires_at: "2026-06-18T00:00:15.000Z",
  };
}

function service(overrides: {
  availableQuota?: number;
  repository?: TaskBillingRepository;
  adjustQuota?: (input: AdjustQuotaInput) => Promise<{ ok: true; providerAdjustmentId: string } | { ok: false; code: string; message: string; retryable: boolean }>;
} = {}) {
  const taskRepository = overrides.repository || createMemoryTaskBillingRepository();
  const usageRepository = createMemoryUsageLogRepository();
  const mappingRepository = createMemoryNewApiUserMappingRepository(mappingSeed());
  const quotaCache = new QuotaDisplayCache(15_000);
  const adjustments: AdjustQuotaInput[] = [];
  const taskBilling = new TaskBillingService({
    taskRepository,
    usageRepository,
    mappingRepository,
    quotaCache,
    now: () => new Date("2026-06-18T00:00:00.000Z"),
    getQuotaSnapshot: async (localUserId) => ({
      ok: true,
      snapshot: snapshot(overrides.availableQuota ?? 100, localUserId),
    }),
    adjustQuota: overrides.adjustQuota || (async (input) => {
      adjustments.push(input);
      return { ok: true, providerAdjustmentId: `adjust:${input.idempotencyKey}` };
    }),
  });
  return { taskBilling, taskRepository, usageRepository, mappingRepository, adjustments };
}

async function precheckAndAccept(harness = service(), taskId = "task-1") {
  const precheck = await harness.taskBilling.precheck({
    localUserId: "local-user",
    taskId,
    operation: "cloud_image_generation",
    estimatedQuotaUnits: 10,
    idempotencyKey: `idem-${taskId}`,
  });
  assert.equal(precheck.ok, true);
  if (!precheck.ok) throw new Error("precheck failed");
  const accepted = await harness.taskBilling.accept({
    localUserId: "local-user",
    taskId,
    newApiTaskId: `new-api-${taskId}`,
    upstreamRequestId: `req-${taskId}`,
  });
  assert.equal(accepted.ok, true);
  return precheck.record;
}

test("prechecks sufficient quota and denies insufficient quota before upstream submission", async () => {
  const enough = service({ availableQuota: 15 });
  const prechecked = await enough.taskBilling.precheck({
    localUserId: "local-user",
    taskId: "task-precheck",
    operation: "cloud_video_generation",
    estimatedQuotaUnits: 10,
    idempotencyKey: "idem-precheck",
  });
  assert.equal(prechecked.ok, true);
  if (!prechecked.ok) return;
  assert.equal(prechecked.action, "prechecked");
  assert.equal(prechecked.record.billing_state, "prechecked");

  const low = service({ availableQuota: 5 });
  const rejected = await low.taskBilling.precheck({
    localUserId: "local-user",
    taskId: "task-low",
    operation: "cloud_video_generation",
    estimatedQuotaUnits: 10,
    idempotencyKey: "idem-low",
  });
  assert.equal(rejected.ok, false);
  if (rejected.ok) return;
  assert.equal(rejected.code, "insufficient_quota");
  assert.equal((await low.usageRepository.getByTaskId("local-user", "task-low"))?.status, "failed");
  assert.equal(low.adjustments.length, 0);
});

test("settles successful task only once across duplicate callbacks", async () => {
  const harness = service();
  await precheckAndAccept(harness, "task-success");

  const first = await harness.taskBilling.settleSuccess({
    localUserId: "local-user",
    taskId: "task-success",
    actualQuotaUnits: 7,
    upstreamLogId: "log-1",
  });
  const duplicate = await harness.taskBilling.settleSuccess({
    localUserId: "local-user",
    taskId: "task-success",
    actualQuotaUnits: 7,
    upstreamLogId: "log-1",
  });

  assert.equal(first.ok, true);
  assert.equal(duplicate.ok, true);
  if (!first.ok || !duplicate.ok) return;
  assert.equal(first.action, "settled");
  assert.equal(duplicate.action, "idempotent");
  assert.equal(harness.adjustments.length, 1);
  assert.equal(harness.adjustments[0].quotaDelta, -7);
  const usage = await harness.usageRepository.getByTaskId("local-user", "task-success");
  assert.equal(usage?.status, "succeeded");
  assert.equal(usage?.actual_quota_units, 7);
});

test("failure and cancellation before settlement do not charge quota", async () => {
  const harness = service();
  await precheckAndAccept(harness, "task-fail");
  const failed = await harness.taskBilling.fail({
    localUserId: "local-user",
    taskId: "task-fail",
    reason: "provider failed Authorization=Bearer secret-token",
  });
  assert.equal(failed.ok, true);
  if (!failed.ok) return;
  assert.equal(failed.action, "failed");
  assert.equal(harness.adjustments.length, 0);
  const usage = await harness.usageRepository.getByTaskId("local-user", "task-fail");
  assert.equal(usage?.status, "failed");
  assert.equal(usage?.actual_quota_units, 0);
  assert.equal(usage?.error_message?.includes("secret-token"), false);

  const cancelledHarness = service();
  await precheckAndAccept(cancelledHarness, "task-cancel");
  const cancelled = await cancelledHarness.taskBilling.cancel({
    localUserId: "local-user",
    taskId: "task-cancel",
    reason: "user cancelled token=hidden",
  });
  assert.equal(cancelled.ok, true);
  assert.equal(cancelledHarness.adjustments.length, 0);
  const cancelledUsage = await cancelledHarness.usageRepository.getByTaskId("local-user", "task-cancel");
  assert.equal(cancelledUsage?.status, "cancelled");
  assert.equal(cancelledUsage?.error_message?.includes("hidden"), false);
});

test("failure after settlement refunds once and duplicate failure stays idempotent", async () => {
  const harness = service();
  await precheckAndAccept(harness, "task-refund");
  const settled = await harness.taskBilling.settleSuccess({
    localUserId: "local-user",
    taskId: "task-refund",
    actualQuotaUnits: 9,
  });
  assert.equal(settled.ok, true);

  const failed = await harness.taskBilling.fail({
    localUserId: "local-user",
    taskId: "task-refund",
    reason: "late failure",
  });
  const duplicate = await harness.taskBilling.fail({
    localUserId: "local-user",
    taskId: "task-refund",
    reason: "late failure",
  });

  assert.equal(failed.ok, true);
  assert.equal(duplicate.ok, true);
  if (!failed.ok || !duplicate.ok) return;
  assert.equal(failed.action, "refunded");
  assert.equal(duplicate.action, "idempotent");
  assert.deepEqual(harness.adjustments.map((input) => input.quotaDelta), [-9, 9]);
  const usage = await harness.usageRepository.getByTaskId("local-user", "task-refund");
  assert.equal(usage?.status, "refunded");
});

test("concurrent settlement does not duplicate quota adjustment", async () => {
  let releaseAdjustment: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    releaseAdjustment = resolve;
  });
  const adjustments: AdjustQuotaInput[] = [];
  const harness = service({
    adjustQuota: async (input) => {
      adjustments.push(input);
      await gate;
      return { ok: true, providerAdjustmentId: `adjust:${input.idempotencyKey}` };
    },
  });
  await precheckAndAccept(harness, "task-concurrent");

  const requests = Array.from({ length: 3 }, () => harness.taskBilling.settleSuccess({
    localUserId: "local-user",
    taskId: "task-concurrent",
    actualQuotaUnits: 6,
  }));
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
  releaseAdjustment();
  const results = await Promise.all(requests);

  assert.equal(results.every((result) => result.ok), true);
  assert.equal(results.filter((result) => result.ok && result.action === "settled").length, 1);
  assert.equal(adjustments.length, 1);
});

test("database failure before settlement does not produce quota adjustment or leak secrets", async () => {
  const repository: TaskBillingRepository = {
    getByTaskId: async () => {
      throw new Error("connect ECONNREFUSED postgresql://user:password@10.0.0.5:5432/app?token=secret-token");
    },
    getByIdempotencyKey: async () => null,
    createPrecheck: async () => {
      throw new Error("not used");
    },
    update: async () => {
      throw new Error("not used");
    },
  };
  const harness = service({ repository });
  const result = await harness.taskBilling.settleSuccess({
    localUserId: "local-user",
    taskId: "missing-db",
    actualQuotaUnits: 5,
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "task_billing_unavailable");
  assert.equal(harness.adjustments.length, 0);
  assert.equal(JSON.stringify(result).includes("postgresql://"), false);
  assert.equal(JSON.stringify(result).includes("secret-token"), false);
});

test("local write failure after quota adjustment enters repair state without duplicate charge", async () => {
  const taskRepository = createMemoryTaskBillingRepository();
  const harness = service({ repository: taskRepository });
  await precheckAndAccept(harness, "task-write-failure");
  const originalUpdate = taskRepository.update.bind(taskRepository);
  let failFinalWrite = true;
  taskRepository.update = async (recordId, patch, expectedVersion) => {
    if (failFinalWrite && patch.billing_state === "settled") {
      failFinalWrite = false;
      throw new Error("write failed password=hidden token=secret-token");
    }
    return originalUpdate(recordId, patch, expectedVersion);
  };

  const first = await harness.taskBilling.settleSuccess({
    localUserId: "local-user",
    taskId: "task-write-failure",
    actualQuotaUnits: 5,
  });
  assert.equal(first.ok, false);
  if (first.ok) return;
  assert.equal(first.code, "task_billing_unavailable");

  const retry = await harness.taskBilling.settleSuccess({
    localUserId: "local-user",
    taskId: "task-write-failure",
    actualQuotaUnits: 5,
  });
  assert.equal(retry.ok, true);
  if (!retry.ok) return;
  assert.equal(retry.action, "reconciliation_required");
  assert.equal(harness.adjustments.length, 1);
  assert.equal(JSON.stringify(first).includes("secret-token"), false);
  assert.equal(JSON.stringify(first).includes("hidden"), false);
});

async function resetTaskBillingTables() {
  await applicationQuery("truncate table audit_events, task_billing_records, usage_records, billing_idempotency_keys, billing_webhook_events, billing_orders, new_api_user_mappings, auth_sessions, app_users restart identity cascade");
}

async function seedPostgresUser(localUserId: string) {
  await applicationQuery(`
    insert into app_users(
      local_user_id, email, username, display_name, password_hash, status, role,
      session_version, created_at, updated_at, last_login_at
    ) values ($1,'task-billing-pg@example.com','task_billing_pg','Task Billing PG',$2,'active','user',1,$3,$3,null)
  `, [
    localUserId,
    "scrypt$v=1$n=16384$r=8$p=1$len=64$c2FsdA$0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "2026-06-18T00:00:00.000Z",
  ]);
}

async function seedPostgresMapping(localUserId: string, newApiUserId: string) {
  const mappingRepository = createPostgresNewApiUserMappingRepository();
  await mappingRepository.createPending({
    localUserId,
    idempotencyKey: `register:${localUserId}`,
    now: new Date("2026-06-18T00:00:00.000Z"),
  });
  await mappingRepository.markActive({
    localUserId,
    newApiUserId,
    now: new Date("2026-06-18T00:00:00.000Z"),
  });
}

dbTest("postgres task billing repository persists lifecycle without JSON fallback", async () => {
  await resetTaskBillingTables();
  const localUserId = "44444444-4444-4444-8444-444444444444";
  await seedPostgresUser(localUserId);
  await seedPostgresMapping(localUserId, "9401");

  const adjustments: AdjustQuotaInput[] = [];
  const taskBilling = new TaskBillingService({
    taskRepository: createPostgresTaskBillingRepository(),
    usageRepository: createMemoryUsageLogRepository(),
    mappingRepository: createPostgresNewApiUserMappingRepository(),
    now: () => new Date("2026-06-18T00:00:00.000Z"),
    getQuotaSnapshot: async () => ({ ok: true, snapshot: snapshot(100, localUserId, "9401") }),
    adjustQuota: async (input) => {
      adjustments.push(input);
      return { ok: true, providerAdjustmentId: `adjust:${input.idempotencyKey}` };
    },
  });

  const prechecked = await taskBilling.precheck({
    localUserId,
    taskId: "pg-task",
    operation: "cloud_image_generation",
    estimatedQuotaUnits: 12,
    idempotencyKey: "pg-task-idem",
  });
  assert.equal(prechecked.ok, true);
  const accepted = await taskBilling.accept({ localUserId, taskId: "pg-task", newApiTaskId: "new-api-pg-task" });
  assert.equal(accepted.ok, true);
  const settled = await taskBilling.settleSuccess({ localUserId, taskId: "pg-task", actualQuotaUnits: 8 });
  assert.equal(settled.ok, true);
  const duplicate = await taskBilling.settleSuccess({ localUserId, taskId: "pg-task", actualQuotaUnits: 8 });
  assert.equal(duplicate.ok, true);

  assert.equal(adjustments.length, 1);
  const rows = await applicationQuery<{ billing_state: string; final_quota_units: number; new_api_task_id: string }>(
    "select billing_state, final_quota_units, new_api_task_id from task_billing_records where local_user_id = $1",
    [localUserId],
  );
  assert.equal(rows.rows[0]?.billing_state, "settled");
  assert.equal(Number(rows.rows[0]?.final_quota_units), 8);
  assert.equal(rows.rows[0]?.new_api_task_id, "new-api-pg-task");
});

test.after(async () => {
  await closeApplicationDatabasePool();
});
