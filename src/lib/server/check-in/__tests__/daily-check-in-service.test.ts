import assert from "node:assert/strict";
import { test } from "node:test";

import { createMemoryNewApiUserMappingRepository, type NewApiUserMapping } from "../../integrations/new-api";
import { createMemoryTaskBillingRepository } from "../../quota";
import { DAILY_CHECK_IN_REWARD_CREDITS, createDailyCheckInService } from "../service";
import { createMemoryDailyCheckInRepository } from "../repository";

function mapping(localUserId = "11111111-1111-4111-8111-111111111111", newApiUserId = "100"): NewApiUserMapping {
  return {
    local_user_id: localUserId,
    new_api_user_id: newApiUserId,
    sync_status: "active",
    created_at: "2026-07-03T00:00:00.000Z",
    updated_at: "2026-07-03T00:00:00.000Z",
    last_sync_at: "2026-07-03T00:00:00.000Z",
    last_error_code: null,
    last_error_message: null,
    retry_count: 0,
    version: 1,
    idempotency_key: `mapping:${localUserId}`,
  };
}

function harness(input: { now?: Date; quota?: number; failFirstWrite?: boolean } = {}) {
  const localUserId = "11111111-1111-4111-8111-111111111111";
  let now = input.now || new Date("2026-07-03T08:00:00.000Z");
  let providerQuota = input.quota ?? 100;
  let writeCount = 0;
  let failFirstWrite = Boolean(input.failFirstWrite);
  const repository = createMemoryDailyCheckInRepository();
  const service = createDailyCheckInService({
    repository,
    mappingRepository: createMemoryNewApiUserMappingRepository([mapping(localUserId)]),
    taskRepository: createMemoryTaskBillingRepository(),
    getProviderQuota: async () => providerQuota,
    setProviderQuota: async (_newApiUserId, quota) => {
      writeCount += 1;
      if (failFirstWrite) {
        failFirstWrite = false;
        throw new Error("simulated quota write failure token:hidden");
      }
      providerQuota = quota;
    },
    invalidateQuota: () => undefined,
    now: () => now,
  });
  return {
    localUserId,
    service,
    repository,
    setNow(next: string) {
      now = new Date(next);
    },
    get providerQuota() {
      return providerQuota;
    },
    get writeCount() {
      return writeCount;
    },
  };
}

test("daily check-in credits once per Beijing date", async () => {
  const app = harness();
  const first = await app.service.claim(app.localUserId);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.action, "credited");
  assert.equal(first.quota_delta, DAILY_CHECK_IN_REWARD_CREDITS);
  assert.equal(first.checkIn.status, "checked");
  assert.equal(first.checkIn.check_in_date, "2026-07-03");
  assert.equal(app.providerQuota, 100 + DAILY_CHECK_IN_REWARD_CREDITS);
  assert.equal(app.writeCount, 1);
  assert.equal(first.records[0]?.balance_after_quota_units, 100 + DAILY_CHECK_IN_REWARD_CREDITS);

  const duplicate = await app.service.claim(app.localUserId);
  assert.equal(duplicate.ok, true);
  if (!duplicate.ok) return;
  assert.equal(duplicate.action, "already_checked");
  assert.equal(duplicate.quota_delta, 0);
  assert.equal(app.providerQuota, 100 + DAILY_CHECK_IN_REWARD_CREDITS);
  assert.equal(app.writeCount, 1);

  const status = await app.service.getStatus(app.localUserId);
  assert.equal(status.checkIn.status, "checked");
  assert.equal(status.records.length, 1);
});

test("daily check-in resets at Beijing midnight", async () => {
  const app = harness({ now: new Date("2026-07-03T15:59:00.000Z") });
  const first = await app.service.claim(app.localUserId);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.checkIn.check_in_date, "2026-07-03");

  app.setNow("2026-07-03T16:00:00.000Z");
  const second = await app.service.claim(app.localUserId);
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.action, "credited");
  assert.equal(second.checkIn.check_in_date, "2026-07-04");
  assert.equal(app.providerQuota, 100 + (DAILY_CHECK_IN_REWARD_CREDITS * 2));
  assert.equal(app.writeCount, 2);
  assert.equal(second.records.length, 2);
});

test("failed daily check-in can be retried without double credit", async () => {
  const app = harness({ failFirstWrite: true });
  const failed = await app.service.claim(app.localUserId);
  assert.equal(failed.ok, false);
  if (!failed.ok) assert.equal(failed.code, "quota_unavailable");
  assert.equal(app.providerQuota, 100);
  assert.equal(app.writeCount, 1);

  const statusAfterFailure = await app.service.getStatus(app.localUserId);
  assert.equal(statusAfterFailure.checkIn.status, "available");
  assert.equal(statusAfterFailure.records.length, 0);

  const retry = await app.service.claim(app.localUserId);
  assert.equal(retry.ok, true);
  if (!retry.ok) return;
  assert.equal(retry.action, "credited");
  assert.equal(app.providerQuota, 100 + DAILY_CHECK_IN_REWARD_CREDITS);
  assert.equal(app.writeCount, 2);

  const duplicate = await app.service.claim(app.localUserId);
  assert.equal(duplicate.ok, true);
  if (!duplicate.ok) return;
  assert.equal(duplicate.action, "already_checked");
  assert.equal(app.providerQuota, 100 + DAILY_CHECK_IN_REWARD_CREDITS);
  assert.equal(app.writeCount, 2);
});
