import assert from "node:assert/strict";
import { test } from "node:test";

import { applicationQuery, closeApplicationDatabasePool } from "../../database";
import {
  NewApiError,
  createMemoryNewApiUserMappingRepository,
  type NewApiResponse,
  type NewApiUserMapping,
} from "../../integrations/new-api";
import { QuotaDisplayCache } from "../cache";
import { createMemoryUsageLogRepository } from "../repository";
import { QuotaService } from "../service";
import { type UsageLogEntry } from "../types";

const hasDatabase = Boolean(process.env.APP_DATABASE_URL && process.env.APP_DATABASE_EXPECTED_NAME);
const dbTest = hasDatabase ? test : test.skip;

function mappingSeed(localUserId = "local-user", newApiUserId = "100"): NewApiUserMapping[] {
  const now = "2026-06-18T00:00:00.000Z";
  return [{
    local_user_id: localUserId,
    new_api_user_id: newApiUserId,
    sync_status: "active" as const,
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

function failedMappingSeed(localUserId = "local-user"): NewApiUserMapping[] {
  return [{
    ...mappingSeed(localUserId, "100")[0],
    new_api_user_id: null,
    sync_status: "failed" as const,
    last_error_code: "NEW_API_TIMEOUT",
    last_error_message: "timeout",
  }];
}

function response<T>(data: T, status = 200): NewApiResponse<T> {
  return { data, requestId: "test-request", upstreamStatus: status };
}

function service(overrides: {
  quota?: number | string;
  usedQuota?: number | string;
  mappings?: NewApiUserMapping[];
  usageSeed?: UsageLogEntry[];
  now?: () => Date;
  getNewApiUser?: unknown;
  getNewApiLogs?: unknown;
  quotaCache?: QuotaDisplayCache;
} = {}) {
  const mappingRepository = createMemoryNewApiUserMappingRepository(overrides.mappings || mappingSeed());
  const usageRepository = createMemoryUsageLogRepository(overrides.usageSeed || []);
  const quotaCache = overrides.quotaCache || new QuotaDisplayCache(15_000);
  const calls = { user: 0, logs: 0 };
  const quota = overrides.quota ?? 100;
  const usedQuota = overrides.usedQuota ?? 40;
  const quotaService = new QuotaService({
    mappingRepository,
    usageRepository,
    quotaCache,
    now: overrides.now,
    getNewApiUser: (overrides.getNewApiUser || (async () => {
      calls.user += 1;
      return response({
        id: 100,
        username: "mapped-user",
        quota,
        used_quota: usedQuota,
      });
    })) as never,
    getNewApiLogs: (overrides.getNewApiLogs || (async () => {
      calls.logs += 1;
      return response({
        data: [
          {
            id: 900,
            request_id: "req-900",
            task_id: "task-upstream",
            model_name: "test-model",
            quota: 11,
            created_at: 1781740800,
          },
        ],
        total: 1,
      });
    })) as never,
  });

  return { service: quotaService, mappingRepository, usageRepository, quotaCache, calls };
}

test("reads current quota from New API raw quota units without creating a local balance", async () => {
  const harness = service({ quota: 100, usedQuota: 40 });
  const result = await harness.service.getCurrentQuota("local-user");

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.snapshot.quota_units, 100);
  assert.equal(result.snapshot.used_quota_units, 40);
  assert.equal(result.snapshot.available_quota_units, 60);
  assert.equal(result.snapshot.display_unit, "credits");
  assert.equal(result.snapshot.source, "new_api");
  assert.equal(result.snapshot.cached, false);
  assert.equal((await harness.usageRepository.listForUser("local-user")).total, 0);
});

test("supports zero quota and denies positive precheck estimates", async () => {
  const harness = service({ quota: 0, usedQuota: 0 });
  const result = await harness.service.precheck({
    localUserId: "local-user",
    estimatedQuotaUnits: 1,
    operation: "cloud_image_generation",
    taskId: "task-zero",
    idempotencyKey: "idem-zero",
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "insufficient_quota");
  const usage = await harness.usageRepository.getByTaskId("local-user", "task-zero");
  assert.equal(usage?.status, "failed");
  assert.equal(usage?.actual_quota_units, null);
});

test("allows large quota values without precision loss for safe integers", async () => {
  const maxSafe = Number.MAX_SAFE_INTEGER;
  const result = await service({ quota: maxSafe, usedQuota: 1 }).service.getCurrentQuota("local-user");

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.snapshot.available_quota_units, maxSafe - 1);
});

test("records successful precheck idempotently and invalidates display cache", async () => {
  const cache = new QuotaDisplayCache(15_000);
  const harness = service({ quotaCache: cache });
  const firstSnapshot = await harness.service.getCurrentQuota("local-user", { allowCached: false });
  assert.equal(firstSnapshot.ok, true);
  assert.equal(cache.get("local-user")?.cached, true);

  const input = {
    localUserId: "local-user",
    estimatedQuotaUnits: 10,
    operation: "cloud_video_generation" as const,
    taskId: "task-precheck",
    idempotencyKey: "idem-precheck",
  };
  const first = await harness.service.precheck(input);
  const second = await harness.service.precheck(input);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.equal(first.usage.id, second.usage.id);
  assert.equal(first.usage.status, "prechecked");
  assert.equal(cache.get("local-user"), null);
  assert.equal((await harness.usageRepository.listForUser("local-user")).total, 1);
});

test("rejects invalid precheck input before calling New API", async () => {
  const harness = service();
  const result = await harness.service.precheck({
    localUserId: "local-user",
    estimatedQuotaUnits: Number.NaN,
    operation: "cloud_image_generation",
    taskId: "",
    idempotencyKey: "",
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "invalid_quota_request");
  assert.equal(harness.calls.user, 0);
});

test("fails closed when New API quota is unavailable", async () => {
  const harness = service({
    getNewApiUser: async () => {
      throw new NewApiError({
        code: "NEW_API_NETWORK",
        message: "network failed",
        status: 502,
        retryable: true,
        requestId: "network-test",
      });
    },
  });

  const result = await harness.service.getCurrentQuota("local-user");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "upstream_unavailable");
  assert.equal((await harness.usageRepository.listForUser("local-user")).total, 0);
});

test("blocks quota and usage when New API mapping is missing or not active", async () => {
  const missing = await service({ mappings: [] }).service.getCurrentQuota("local-user");
  const failed = await service({ mappings: failedMappingSeed() }).service.listUpstreamUsage("local-user");

  assert.equal(missing.ok, false);
  if (missing.ok) return;
  assert.equal(missing.code, "mapping_pending");
  assert.equal("ok" in failed && failed.ok, false);
  if (!("ok" in failed) || failed.ok) return;
  assert.equal(failed.code, "mapping_pending");
});

test("lists local usage by local user only and paginates results", async () => {
  const harness = service();
  await harness.service.recordUsage({
    localUserId: "local-user",
    newApiUserId: "100",
    taskId: "visible-1",
    operation: "cloud_image_generation",
    status: "succeeded",
    estimatedQuotaUnits: 5,
    actualQuotaUnits: 4,
    idempotencyKey: "visible-1",
  });
  await harness.service.recordUsage({
    localUserId: "other-user",
    newApiUserId: "200",
    taskId: "hidden-1",
    operation: "cloud_image_generation",
    status: "succeeded",
    estimatedQuotaUnits: 5,
    actualQuotaUnits: 4,
    idempotencyKey: "hidden-1",
  });
  await harness.service.recordUsage({
    localUserId: "local-user",
    newApiUserId: "100",
    taskId: "visible-2",
    operation: "cloud_video_upscale",
    status: "failed",
    estimatedQuotaUnits: 9,
    actualQuotaUnits: null,
    idempotencyKey: "visible-2",
    errorMessage: "Authorization=Bearer secret-token password=hidden",
  });

  const page = await harness.service.listLocalUsage("local-user", 1, 1);
  assert.equal(page.total, 2);
  assert.equal(page.entries.length, 1);
  assert.equal(page.entries[0].local_user_id, "local-user");
  assert.notEqual(page.entries[0].task_id, "hidden-1");

  const failed = await harness.service.getTaskUsage("local-user", "visible-2");
  assert.equal(failed?.status, "failed");
  assert.equal(failed?.error_message?.includes("secret-token"), false);
  assert.equal(failed?.error_message?.includes("hidden"), false);
});

test("maps upstream New API logs into read-only usage pages", async () => {
  const result = await service().service.listUpstreamUsage("local-user", 1, 20);

  assert.equal("ok" in result, false);
  if ("ok" in result) return;
  assert.equal(result.total, 1);
  assert.equal(result.entries[0].task_id, "task-upstream");
  assert.equal(result.entries[0].actual_quota_units, 11);
  assert.equal(result.entries[0].upstream_request_id, "req-900");
  assert.equal(result.entries[0].local_user_id, "local-user");
});

test("returns usage_unavailable for upstream log failures and rate_limited for 429", async () => {
  const unavailable = await service({
    getNewApiLogs: async () => {
      throw new NewApiError({
        code: "NEW_API_UPSTREAM_ERROR",
        message: "server failed",
        status: 502,
        upstreamStatus: 500,
        retryable: true,
        requestId: "usage-500",
      });
    },
  }).service.listUpstreamUsage("local-user");

  assert.equal("ok" in unavailable && unavailable.ok, false);
  if (!("ok" in unavailable) || unavailable.ok) return;
  assert.equal(unavailable.code, "usage_unavailable");

  const limited = await service({
    getNewApiLogs: async () => {
      throw new NewApiError({
        code: "NEW_API_UPSTREAM_ERROR",
        message: "rate limited",
        status: 429,
        upstreamStatus: 429,
        retryable: true,
        requestId: "usage-429",
      });
    },
  }).service.listUpstreamUsage("local-user");

  assert.equal("ok" in limited && limited.ok, false);
  if (!("ok" in limited) || limited.ok) return;
  assert.equal(limited.code, "rate_limited");
});

async function resetQuotaTables() {
  await applicationQuery("truncate table audit_events, task_quota_adjustments, task_billing_records, usage_records, billing_idempotency_keys, billing_webhook_events, billing_orders, new_api_user_mappings, auth_sessions, app_users restart identity cascade");
}

dbTest("default quota service uses PostgreSQL mapping and usage repositories in postgres mode", async () => {
  await resetQuotaTables();
  const previousMode = process.env.APP_TASK_BILLING_PERSISTENCE_MODE;
  const localUserId = "66666666-6666-4666-8666-666666666666";
  try {
    process.env.APP_TASK_BILLING_PERSISTENCE_MODE = "postgres";
    await applicationQuery(`
      insert into app_users(
        local_user_id, email, username, display_name, password_hash, status, role,
        session_version, created_at, updated_at, last_login_at
      ) values ($1,'quota-pg@example.com','quota_pg','Quota PG',$2,'active','user',1,$3,$3,null)
    `, [
      localUserId,
      "scrypt$v=1$n=16384$r=8$p=1$len=64$c2FsdA$0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      "2026-06-18T00:00:00.000Z",
    ]);
    await applicationQuery(`
      insert into new_api_user_mappings(
        local_user_id, new_api_user_id, sync_status, created_at, updated_at, last_sync_at,
        last_error_code, last_error_message, retry_count, version, idempotency_key
      ) values ($1,'9601','active',$2,$2,$2,null,null,0,1,'register:quota-pg')
    `, [localUserId, "2026-06-18T00:00:00.000Z"]);

    const quotaService = new QuotaService({
      getNewApiUser: (async () => response({
        id: 9601,
        username: "quota-pg",
        quota: 25,
        used_quota: 5,
      })) as never,
    });
    const snapshot = await quotaService.getCurrentQuota(localUserId, { allowCached: false });
    assert.equal(snapshot.ok, true);
    if (!snapshot.ok) return;
    assert.equal(snapshot.snapshot.new_api_user_id, "9601");

    await quotaService.recordUsage({
      localUserId,
      newApiUserId: "9601",
      taskId: "quota-pg-task",
      operation: "cloud_image_generation",
      status: "prechecked",
      estimatedQuotaUnits: 5,
      actualQuotaUnits: null,
      idempotencyKey: "quota-pg-task",
    });
    const rows = await applicationQuery<{ count: string }>(
      "select count(*)::text as count from usage_records where local_user_id = $1 and task_id = 'quota-pg-task'",
      [localUserId],
    );
    assert.equal(rows.rows[0]?.count, "1");
  } finally {
    if (previousMode === undefined) delete process.env.APP_TASK_BILLING_PERSISTENCE_MODE;
    else process.env.APP_TASK_BILLING_PERSISTENCE_MODE = previousMode;
  }
});

test.after(async () => {
  await closeApplicationDatabasePool();
});
