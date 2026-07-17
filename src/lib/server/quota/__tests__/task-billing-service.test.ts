import assert from "node:assert/strict";
import { test } from "node:test";

import { applicationQuery, closeApplicationDatabasePool } from "../../database";
import {
  createMemoryNewApiUserMappingRepository,
  type NewApiUserMapping,
} from "../../integrations/new-api";
import { createPostgresNewApiUserMappingRepository } from "../../integrations/new-api/postgres-user-mapping";
import { createMemoryAuthRepository } from "../../auth/repository";
import { createMemoryMembershipRepository } from "../../membership/repository";
import { MembershipService } from "../../membership/service";
import {
  resetWorkloadLimiterForTests,
  WorkloadLimitError,
  withUserImageEditWorkload,
  withUserImageWorkload,
  withUserVideoWorkload,
  withVideoUploadPhase,
} from "../../workload-guard";
import { createMemoryUsageLogRepository } from "../repository";
import { createPostgresUsageLogRepository } from "../postgres-usage-repository";
import { QuotaDisplayCache } from "../cache";
import { createMemoryTaskBillingRepository, type TaskBillingRepository } from "../task-billing-repository";
import { createPostgresTaskBillingRepository } from "../postgres-task-billing-repository";
import { TaskBillingService, type AdjustQuotaInput } from "../task-billing-service";
import {
  createTaskBillingPersistenceRepositories,
  TaskBillingPersistenceConfigError,
} from "../task-billing-persistence";
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
  providerQuota?: number;
  repository?: TaskBillingRepository;
  adjustQuota?: (input: AdjustQuotaInput) => Promise<{ ok: true; providerAdjustmentId: string } | { ok: false; code: string; message: string; retryable: boolean }>;
  getProviderQuota?: (newApiUserId: string) => Promise<{ ok: true; quota: number } | { ok: false; code: string; message: string; retryable: boolean }>;
} = {}) {
  const taskRepository = overrides.repository || createMemoryTaskBillingRepository();
  const usageRepository = createMemoryUsageLogRepository();
  const mappingRepository = createMemoryNewApiUserMappingRepository(mappingSeed());
  const membershipService = new MembershipService({
    repository: createMemoryMembershipRepository(),
    now: () => new Date("2026-06-18T00:00:00.000Z"),
  });
  const quotaCache = new QuotaDisplayCache(15_000);
  const adjustments: AdjustQuotaInput[] = [];
  let providerQuota = overrides.providerQuota ?? overrides.availableQuota ?? 100;
  const taskBilling = new TaskBillingService({
    taskRepository,
    usageRepository,
    mappingRepository,
    membershipService,
    quotaCache,
    now: () => new Date("2026-06-18T00:00:00.000Z"),
    getQuotaSnapshot: async (localUserId) => ({
      ok: true,
      snapshot: snapshot(overrides.availableQuota ?? 100, localUserId),
    }),
    getProviderQuota: overrides.getProviderQuota || (async () => ({ ok: true, quota: providerQuota })),
    adjustQuota: overrides.adjustQuota || (async (input) => {
      adjustments.push(input);
      providerQuota = input.targetQuota ?? providerQuota + input.quotaDelta;
      return { ok: true, providerAdjustmentId: `adjust:${input.idempotencyKey}` };
    }),
  });
  return {
    taskBilling,
    taskRepository,
    usageRepository,
    mappingRepository,
    membershipService,
    adjustments,
    get providerQuota() {
      return providerQuota;
    },
    set providerQuota(value: number) {
      providerQuota = value;
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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
    requestFingerprint: "video:task-precheck:10",
  });
  assert.equal(prechecked.ok, true);
  if (!prechecked.ok) return;
  assert.equal(prechecked.action, "prechecked");
  assert.equal(prechecked.record.billing_state, "prechecked");
  assert.equal(prechecked.record.request_fingerprint, "video:task-precheck:10");

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

test("uses membership image entitlement before charging quota", async () => {
  const harness = service({ availableQuota: 0, providerQuota: 0 });
  await harness.membershipService.applyPaidMembership({
    localUserId: "local-user",
    orderId: "membership-image-entitlement",
    planId: "basic",
    cycle: "monthly",
    now: new Date("2026-06-18T00:00:00.000Z"),
  });
  const prechecked = await harness.taskBilling.precheck({
    localUserId: "local-user",
    taskId: "member-image-task",
    operation: "cloud_image_generation",
    estimatedQuotaUnits: 10,
    idempotencyKey: "member-image-task",
  });
  assert.equal(prechecked.ok, true);
  if (!prechecked.ok) return;
  assert.equal(prechecked.record.estimated_quota_units, 10);
  assert.equal(prechecked.record.membership_entitlement_kind, "image_generation");
  assert.equal(prechecked.record.membership_entitlement_units, 1);

  const settled = await harness.taskBilling.settleSuccess({
    localUserId: "local-user",
    taskId: "member-image-task",
    actualQuotaUnits: 10,
  });
  assert.equal(settled.ok, true);
  if (!settled.ok) return;
  assert.equal(settled.record.final_quota_units, 0);
  assert.equal(harness.adjustments.length, 0);
  const status = await harness.membershipService.getStatus("local-user");
  assert.equal(status.entitlements.image_generation.remaining, 10);
  assert.equal(status.entitlements.image_edit.remaining, 0);
});

test("uses one image entitlement per requested batch item", async () => {
  const harness = service({ availableQuota: 0, providerQuota: 0 });
  await harness.membershipService.applyPaidMembership({
    localUserId: "local-user",
    orderId: "membership-image-batch",
    planId: "basic",
    cycle: "monthly",
    now: new Date("2026-06-18T00:00:00.000Z"),
  });
  const prechecked = await harness.taskBilling.precheck({
    localUserId: "local-user",
    taskId: "member-image-batch-task",
    operation: "cloud_image_generation",
    estimatedQuotaUnits: 1000,
    membershipEntitlementAmount: 4,
    idempotencyKey: "member-image-batch-task",
  });
  assert.equal(prechecked.ok, true);
  if (!prechecked.ok) return;
  assert.equal(prechecked.record.membership_entitlement_kind, "image_generation");
  assert.equal(prechecked.record.membership_entitlement_units, 4);
  assert.equal(prechecked.usage?.membership_entitlement_units, 4);
  assert.equal(
    (await harness.usageRepository.getByTaskId("local-user", "member-image-batch-task"))?.membership_entitlement_units,
    4,
  );
  const status = await harness.membershipService.getStatus("local-user");
  assert.equal(status.entitlements.image_generation.remaining, 7);
});

test("enforces the expected image entitlement amount before provider dispatch", async () => {
  const harness = service({ availableQuota: 0, providerQuota: 0 });
  await harness.membershipService.applyPaidMembership({
    localUserId: "local-user",
    orderId: "membership-image-4k",
    planId: "basic",
    cycle: "monthly",
    now: new Date("2026-06-18T00:00:00.000Z"),
  });
  const initialRemaining = (await harness.membershipService.getStatus("local-user")).entitlements.image_generation.remaining;
  const input = {
    localUserId: "local-user",
    taskId: "member-image-4k-task",
    operation: "cloud_image_generation" as const,
    estimatedQuotaUnits: 360,
    membershipEntitlementAmount: 2,
    idempotencyKey: "member-image-4k-task",
    requestFingerprint: "image:4k:member-image-4k-task",
  };
  const prechecked = await harness.taskBilling.precheck(input);
  assert.equal(prechecked.ok, true);
  if (!prechecked.ok) return;
  assert.equal(prechecked.record.membership_entitlement_units, 2);

  const mismatched = await harness.taskBilling.claimProviderDispatch({
    ...input,
    membershipEntitlementAmount: 1,
  });
  assert.equal(mismatched.ok, false);
  assert.equal((await harness.taskRepository.getByTaskId("local-user", input.taskId))?.billing_state, "prechecked");

  const claimed = await harness.taskBilling.claimProviderDispatch(input);
  assert.equal(claimed.ok, true);
  if (!claimed.ok) return;
  assert.equal(claimed.record.billing_state, "dispatching");
  const failed = await harness.taskBilling.fail({
    localUserId: "local-user",
    taskId: input.taskId,
    reason: "test restore",
  });
  assert.equal(failed.ok, true);
  const status = await harness.membershipService.getStatus("local-user");
  assert.equal(status.entitlements.image_generation.remaining, initialRemaining);
});

test("uses and restores two video entitlements for a 4K generation", async () => {
  const harness = service({ availableQuota: 0, providerQuota: 0 });
  await harness.membershipService.applyPaidMembership({
    localUserId: "local-user",
    orderId: "membership-video-4k",
    planId: "advanced",
    cycle: "monthly",
    now: new Date("2026-06-18T00:00:00.000Z"),
  });
  const initialRemaining = (await harness.membershipService.getStatus("local-user")).entitlements.video_generation.remaining;
  const input = {
    localUserId: "local-user",
    taskId: "member-video-4k-task",
    operation: "cloud_video_generation" as const,
    estimatedQuotaUnits: 960,
    membershipEntitlementAmount: 2,
    idempotencyKey: "member-video-4k-task",
    requestFingerprint: "video:4k:member-video-4k-task",
  };
  const prechecked = await harness.taskBilling.precheck(input);
  assert.equal(prechecked.ok, true);
  if (!prechecked.ok) return;
  assert.equal(prechecked.record.membership_entitlement_units, 2);

  const mismatched = await harness.taskBilling.claimProviderDispatch({
    ...input,
    membershipEntitlementAmount: 1,
  });
  assert.equal(mismatched.ok, false);

  const claimed = await harness.taskBilling.claimProviderDispatch(input);
  assert.equal(claimed.ok, true);
  const failed = await harness.taskBilling.fail({
    localUserId: "local-user",
    taskId: input.taskId,
    reason: "test restore",
  });
  assert.equal(failed.ok, true);
  const status = await harness.membershipService.getStatus("local-user");
  assert.equal(status.entitlements.video_generation.remaining, initialRemaining);
});

test("uses and restores two video entitlements for a premium Seedance generation", async () => {
  const harness = service({ availableQuota: 0, providerQuota: 0 });
  await harness.membershipService.applyPaidMembership({
    localUserId: "local-user",
    orderId: "membership-video-seedance-full",
    planId: "enterprise",
    cycle: "monthly",
    now: new Date("2026-06-18T00:00:00.000Z"),
  });
  const initialRemaining = (await harness.membershipService.getStatus("local-user")).entitlements.video_generation.remaining;
  const input = {
    localUserId: "local-user",
    taskId: "member-video-seedance-full-task",
    operation: "cloud_video_generation" as const,
    estimatedQuotaUnits: 1400,
    membershipEntitlementAmount: 2,
    idempotencyKey: "member-video-seedance-full-task",
    requestFingerprint: "video:seedance-full:member-video-seedance-full-task",
  };
  const prechecked = await harness.taskBilling.precheck(input);
  assert.equal(prechecked.ok, true);
  if (!prechecked.ok) return;
  assert.equal(prechecked.record.membership_entitlement_units, 2);

  const claimed = await harness.taskBilling.claimProviderDispatch(input);
  assert.equal(claimed.ok, true);
  const failed = await harness.taskBilling.fail({
    localUserId: "local-user",
    taskId: input.taskId,
    reason: "test premium restore",
  });
  assert.equal(failed.ok, true);
  const status = await harness.membershipService.getStatus("local-user");
  assert.equal(status.entitlements.video_generation.remaining, initialRemaining);
});

test("uses the shared image generation entitlement for image editing", async () => {
  const harness = service({ availableQuota: 0, providerQuota: 0 });
  await harness.membershipService.applyPaidMembership({
    localUserId: "local-user",
    orderId: "membership-image-edit-entitlement",
    planId: "basic",
    cycle: "monthly",
    now: new Date("2026-06-18T00:00:00.000Z"),
  });
  const prechecked = await harness.taskBilling.precheck({
    localUserId: "local-user",
    taskId: "member-image-edit-task",
    operation: "cloud_image_edit",
    estimatedQuotaUnits: 10,
    idempotencyKey: "member-image-edit-task",
  });
  assert.equal(prechecked.ok, true);
  if (!prechecked.ok) return;
  assert.equal(prechecked.record.membership_entitlement_kind, "image_generation");
  assert.equal(prechecked.record.membership_entitlement_units, 1);

  const settled = await harness.taskBilling.settleSuccess({
    localUserId: "local-user",
    taskId: "member-image-edit-task",
    actualQuotaUnits: 10,
  });
  assert.equal(settled.ok, true);
  if (!settled.ok) return;
  assert.equal(settled.record.final_quota_units, 0);
  assert.equal(harness.adjustments.length, 0);
  const status = await harness.membershipService.getStatus("local-user");
  assert.equal(status.entitlements.image_edit.remaining, 0);
  assert.equal(status.entitlements.image_generation.remaining, 10);
});

test("uses prompt and upscale entitlements before charging quota", async () => {
  const cases = [
    {
      operation: "prompt_optimize" as const,
      planId: "basic",
      kind: "prompt_optimize" as const,
      remaining: 10,
    },
    {
      operation: "cloud_image_upscale" as const,
      planId: "basic",
      kind: "image_upscale" as const,
      remaining: 10,
    },
    {
      operation: "cloud_video_upscale" as const,
      planId: "advanced",
      kind: "video_upscale" as const,
      remaining: 1,
    },
  ];

  for (const testCase of cases) {
    const harness = service({ availableQuota: 0, providerQuota: 0 });
    await harness.membershipService.applyPaidMembership({
      localUserId: "local-user",
      orderId: `membership-${testCase.operation}`,
      planId: testCase.planId,
      cycle: "monthly",
      now: new Date("2026-06-18T00:00:00.000Z"),
    });
    const prechecked = await harness.taskBilling.precheck({
      localUserId: "local-user",
      taskId: `task-${testCase.operation}`,
      operation: testCase.operation,
      estimatedQuotaUnits: 10,
      idempotencyKey: `task-${testCase.operation}`,
    });
    assert.equal(prechecked.ok, true);
    if (!prechecked.ok) return;
    assert.equal(prechecked.record.membership_entitlement_kind, testCase.kind, testCase.operation);
    assert.equal(prechecked.record.membership_entitlement_units, 1, testCase.operation);

    const settled = await harness.taskBilling.settleSuccess({
      localUserId: "local-user",
      taskId: `task-${testCase.operation}`,
      actualQuotaUnits: 10,
    });
    assert.equal(settled.ok, true);
    if (!settled.ok) return;
    assert.equal(settled.record.final_quota_units, 0);
    assert.equal(harness.adjustments.length, 0);

    const status = await harness.membershipService.getStatus("local-user");
    assert.equal(status.entitlements[testCase.kind].remaining, testCase.remaining, testCase.operation);
    assert.equal(
      await harness.membershipService.consumedForTask("local-user", `task-${testCase.operation}`),
      1,
      testCase.operation,
    );
  }
});

test("three accounts settle isolated entitlements in parallel without mixed charging", async () => {
  const authRepository = createMemoryAuthRepository();
  const [accountA, accountB, accountC] = await Promise.all([
    authRepository.createUser({
      localUserId: "parallel-a",
      email: "parallel-a@example.com",
      username: "pa001",
      displayName: "Parallel A",
      passwordHash: "hash",
    }),
    authRepository.createUser({
      localUserId: "parallel-b",
      email: "parallel-b@example.com",
      username: "pb001",
      displayName: "Parallel B",
      passwordHash: "hash",
    }),
    authRepository.createUser({
      localUserId: "parallel-c",
      email: "parallel-c@example.com",
      username: "pc001",
      displayName: "Parallel C",
      passwordHash: "hash",
    }),
  ]);
  const quotaByUser = new Map([
    [accountA.local_user_id, snapshot(0, accountA.local_user_id, "101")],
    [accountB.local_user_id, snapshot(0, accountB.local_user_id, "102")],
    [accountC.local_user_id, snapshot(0, accountC.local_user_id, "103")],
  ]);
  const adjustments: AdjustQuotaInput[] = [];
  const membershipService = new MembershipService({
    repository: createMemoryMembershipRepository(),
    now: () => new Date("2026-06-18T00:00:00.000Z"),
  });
  await Promise.all([
    membershipService.applyPaidMembership({
      localUserId: accountA.local_user_id,
      orderId: "parallel-order-a",
      planId: "basic",
      cycle: "monthly",
      now: new Date("2026-06-18T00:00:00.000Z"),
    }),
    membershipService.applyPaidMembership({
      localUserId: accountB.local_user_id,
      orderId: "parallel-order-b",
      planId: "basic",
      cycle: "monthly",
      now: new Date("2026-06-18T00:00:00.000Z"),
    }),
    membershipService.applyPaidMembership({
      localUserId: accountC.local_user_id,
      orderId: "parallel-order-c",
      planId: "advanced",
      cycle: "monthly",
      now: new Date("2026-06-18T00:00:00.000Z"),
    }),
  ]);
  const taskBilling = new TaskBillingService({
    taskRepository: createMemoryTaskBillingRepository(),
    usageRepository: createMemoryUsageLogRepository(),
    mappingRepository: createMemoryNewApiUserMappingRepository([
      ...mappingSeed(accountA.local_user_id, "101"),
      ...mappingSeed(accountB.local_user_id, "102"),
      ...mappingSeed(accountC.local_user_id, "103"),
    ]),
    membershipService,
    quotaCache: new QuotaDisplayCache(15_000),
    now: () => new Date("2026-06-18T00:00:00.000Z"),
    getQuotaSnapshot: async (localUserId) => {
      const current = quotaByUser.get(localUserId);
      assert(current, `quota snapshot missing for ${localUserId}`);
      return { ok: true, snapshot: current };
    },
    getProviderQuota: async (newApiUserId) => ({ ok: true, quota: Number(newApiUserId) }),
    adjustQuota: async (input) => {
      adjustments.push(input);
      return { ok: true, providerAdjustmentId: `adjust:${input.idempotencyKey}` };
    },
  });

  const [generationPrecheck, editPrecheck, videoPrecheck] = await Promise.all([
    taskBilling.precheck({
      localUserId: accountA.local_user_id,
      taskId: "parallel-image-generation",
      operation: "cloud_image_generation",
      estimatedQuotaUnits: 10,
      idempotencyKey: "parallel-image-generation",
    }),
    taskBilling.precheck({
      localUserId: accountB.local_user_id,
      taskId: "parallel-image-edit",
      operation: "cloud_image_edit",
      estimatedQuotaUnits: 10,
      idempotencyKey: "parallel-image-edit",
    }),
    taskBilling.precheck({
      localUserId: accountC.local_user_id,
      taskId: "parallel-video-generation",
      operation: "cloud_video_generation",
      estimatedQuotaUnits: 10,
      idempotencyKey: "parallel-video-generation",
    }),
  ]);

  assert.equal(generationPrecheck.ok, true);
  assert.equal(editPrecheck.ok, true);
  assert.equal(videoPrecheck.ok, true);
  if (!generationPrecheck.ok || !editPrecheck.ok || !videoPrecheck.ok) return;
  assert.equal(generationPrecheck.record.membership_entitlement_kind, "image_generation");
  assert.equal(editPrecheck.record.membership_entitlement_kind, "image_generation");
  assert.equal(videoPrecheck.record.membership_entitlement_kind, "video_generation");

  const [generationSettled, editSettled, videoSettled] = await Promise.all([
    taskBilling.settleSuccess({
      localUserId: accountA.local_user_id,
      taskId: "parallel-image-generation",
      actualQuotaUnits: 10,
    }),
    taskBilling.settleSuccess({
      localUserId: accountB.local_user_id,
      taskId: "parallel-image-edit",
      actualQuotaUnits: 10,
    }),
    taskBilling.settleSuccess({
      localUserId: accountC.local_user_id,
      taskId: "parallel-video-generation",
      actualQuotaUnits: 10,
    }),
  ]);

  assert.equal(generationSettled.ok, true);
  assert.equal(editSettled.ok, true);
  assert.equal(videoSettled.ok, true);
  assert.equal(adjustments.length, 0);

  const [statusA, statusB, statusC] = await Promise.all([
    membershipService.getStatus(accountA.local_user_id),
    membershipService.getStatus(accountB.local_user_id),
    membershipService.getStatus(accountC.local_user_id),
  ]);
  assert.equal(statusA.entitlements.image_generation.remaining, 10);
  assert.equal(statusA.entitlements.image_edit.remaining, 0);
  assert.equal(statusB.entitlements.image_edit.remaining, 0);
  assert.equal(statusB.entitlements.image_generation.remaining, 10);
  assert.equal(statusC.entitlements.video_generation.remaining, 1);
});

test("three-account workload runtime keeps same-user limits and allows cross-account overlap", async () => {
  resetWorkloadLimiterForTests();
  const accountA = "parallel-a";
  const accountB = "parallel-b";
  const accountC = "parallel-c";

  const releaseVideoA = deferred<void>();
  const releaseVideoB = deferred<void>();
  const releaseUploadA = deferred<void>();
  const releaseUploadC = deferred<void>();
  const releaseImageA = deferred<void>();
  const startedVideoA = deferred<number>();
  const startedVideoB = deferred<number>();
  const startedUploadC = deferred<number>();
  const startedImageEditA = deferred<number>();

  let videoAReleasedAt = 0;
  let uploadAReleasedAt = 0;
  let imageAReleasedAt = 0;

  const videoA = withUserVideoWorkload(accountA, async () => {
    startedVideoA.resolve(Date.now());
    await releaseVideoA.promise;
    videoAReleasedAt = Date.now();
    return "video-a";
  });
  await startedVideoA.promise;

  const sameAccountVideo = withUserVideoWorkload(accountA, async () => "video-a-duplicate");
  await assert.rejects(
    sameAccountVideo,
    (error) => error instanceof WorkloadLimitError && /already running for this account/i.test(error.message),
  );

  const videoB = withUserVideoWorkload(accountB, async () => {
    startedVideoB.resolve(Date.now());
    await releaseVideoB.promise;
    return "video-b";
  });
  const videoBStartedAt = await startedVideoB.promise;
  assert.equal(videoBStartedAt <= videoAReleasedAt || videoAReleasedAt === 0, true);

  const uploadA = withVideoUploadPhase(accountA, async () => {
    await releaseUploadA.promise;
    uploadAReleasedAt = Date.now();
    return "upload-a";
  });
  const sameAccountUpload = withVideoUploadPhase(accountA, async () => "upload-a-duplicate");
  await assert.rejects(
    sameAccountUpload,
    (error) => error instanceof WorkloadLimitError && /large upload is already running for this account/i.test(error.message),
  );

  const uploadC = withVideoUploadPhase(accountC, async () => {
    startedUploadC.resolve(Date.now());
    await releaseUploadC.promise;
    return "upload-c";
  });
  const uploadCStartedAt = await startedUploadC.promise;
  assert.equal(uploadCStartedAt <= uploadAReleasedAt || uploadAReleasedAt === 0, true);

  const imageA = withUserImageWorkload(accountA, async () => {
    await releaseImageA.promise;
    imageAReleasedAt = Date.now();
    return "image-a";
  });
  const imageEditA = withUserImageEditWorkload(accountA, async () => {
    startedImageEditA.resolve(Date.now());
    return "image-edit-a";
  });
  const imageEditAStartedAt = await startedImageEditA.promise;
  assert.equal(imageEditAStartedAt <= imageAReleasedAt || imageAReleasedAt === 0, true);

  releaseVideoA.resolve();
  releaseVideoB.resolve();
  releaseUploadA.resolve();
  releaseUploadC.resolve();
  releaseImageA.resolve();

  assert.deepEqual(
    await Promise.all([videoA, videoB, uploadA, uploadC, imageA, imageEditA]),
    ["video-a", "video-b", "upload-a", "upload-c", "image-a", "image-edit-a"],
  );
});

test("server-side generation requires a matching precheck record", async () => {
  const harness = service();
  const missing = await harness.taskBilling.verifyPrecheck({
    localUserId: "local-user",
    taskId: "direct-call",
    idempotencyKey: "direct-call",
    estimatedQuotaUnits: 40,
    requestFingerprint: "image:direct-call:40",
  });
  assert.equal(missing.ok, false);
  if (missing.ok) return;
  assert.equal(missing.code, "task_billing_not_found");

  const prechecked = await harness.taskBilling.precheck({
    localUserId: "local-user",
    taskId: "server-priced",
    operation: "cloud_image_generation",
    estimatedQuotaUnits: 40,
    idempotencyKey: "server-priced",
    requestFingerprint: "image:server-priced:40",
  });
  assert.equal(prechecked.ok, true);

  const tamperedEstimate = await harness.taskBilling.verifyPrecheck({
    localUserId: "local-user",
    taskId: "server-priced",
    idempotencyKey: "server-priced",
    estimatedQuotaUnits: 0,
    requestFingerprint: "image:server-priced:0",
  });
  assert.equal(tamperedEstimate.ok, false);
  if (tamperedEstimate.ok) return;
  assert.equal(tamperedEstimate.code, "task_billing_conflict");

  const tamperedUser = await harness.taskBilling.verifyPrecheck({
    localUserId: "other-user",
    taskId: "server-priced",
    idempotencyKey: "server-priced",
    estimatedQuotaUnits: 40,
    requestFingerprint: "image:server-priced:40",
  });
  assert.equal(tamperedUser.ok, false);
  if (tamperedUser.ok) return;
  assert.equal(tamperedUser.code, "task_billing_not_found");

  const matched = await harness.taskBilling.verifyPrecheck({
    localUserId: "local-user",
    taskId: "server-priced",
    idempotencyKey: "server-priced",
    estimatedQuotaUnits: 40,
    requestFingerprint: "image:server-priced:40",
  });
  assert.equal(matched.ok, true);
});

test("same task can claim provider dispatch only once", async () => {
  const harness = service();
  const input = {
    localUserId: "local-user",
    taskId: "dispatch-once",
    operation: "cloud_image_generation" as const,
    estimatedQuotaUnits: 40,
    idempotencyKey: "dispatch-once",
    requestFingerprint: "image:dispatch-once:40",
  };
  const prechecked = await harness.taskBilling.precheck(input);
  assert.equal(prechecked.ok, true);

  let providerCalls = 0;
  const attempts = await Promise.all([
    harness.taskBilling.claimProviderDispatch(input),
    harness.taskBilling.claimProviderDispatch(input),
  ]);
  for (const attempt of attempts) {
    if (attempt.ok && attempt.action === "dispatching") providerCalls += 1;
  }
  assert.equal(providerCalls, 1);
  assert.equal(attempts.filter((attempt) => !attempt.ok && attempt.code === "task_billing_conflict").length, 1);
});

test("accepted task replay cannot claim provider dispatch again", async () => {
  const harness = service();
  const input = {
    localUserId: "local-user",
    taskId: "accepted-replay",
    operation: "cloud_video_generation" as const,
    estimatedQuotaUnits: 60,
    idempotencyKey: "accepted-replay",
    requestFingerprint: "video:accepted-replay:60",
  };
  const prechecked = await harness.taskBilling.precheck(input);
  assert.equal(prechecked.ok, true);
  const claimed = await harness.taskBilling.claimProviderDispatch(input);
  assert.equal(claimed.ok, true);
  if (!claimed.ok) return;
  assert.equal(claimed.action, "dispatching");
  const started = await harness.taskBilling.markProviderStarted({
    localUserId: "local-user",
    taskId: "accepted-replay",
    upstreamModel: "video-model",
  });
  assert.equal(started.ok, true);
  const accepted = await harness.taskBilling.accept({
    localUserId: "local-user",
    taskId: "accepted-replay",
    newApiTaskId: "new-api-accepted-replay",
  });
  assert.equal(accepted.ok, true);

  const replay = await harness.taskBilling.claimProviderDispatch(input);
  assert.equal(replay.ok, false);
  if (replay.ok) return;
  assert.equal(replay.code, "task_billing_conflict");
});

test("interrupted provider dispatch recovers before start and reconciles after start", async () => {
  const beforeStart = service();
  const beforeStartInput = {
    localUserId: "local-user",
    taskId: "dispatch-before-start",
    operation: "cloud_image_generation" as const,
    estimatedQuotaUnits: 40,
    idempotencyKey: "dispatch-before-start",
    requestFingerprint: "image:dispatch-before-start:40",
  };
  assert.equal((await beforeStart.taskBilling.precheck(beforeStartInput)).ok, true);
  const firstClaim = await beforeStart.taskBilling.claimProviderDispatch(beforeStartInput);
  assert.equal(firstClaim.ok, true);
  const staleDispatch = await beforeStart.taskRepository.getByTaskId("local-user", "dispatch-before-start");
  assert.ok(staleDispatch);
  await beforeStart.taskRepository.update(staleDispatch.id, {
    updated_at: "2026-06-17T23:50:00.000Z",
  }, staleDispatch.version);
  const recovered = await beforeStart.taskBilling.claimProviderDispatch(beforeStartInput);
  assert.equal(recovered.ok, true);
  if (!recovered.ok) return;
  assert.equal(recovered.action, "dispatching");

  const afterStart = service();
  const afterStartInput = {
    localUserId: "local-user",
    taskId: "dispatch-after-start",
    operation: "cloud_image_generation" as const,
    estimatedQuotaUnits: 40,
    idempotencyKey: "dispatch-after-start",
    requestFingerprint: "image:dispatch-after-start:40",
  };
  assert.equal((await afterStart.taskBilling.precheck(afterStartInput)).ok, true);
  assert.equal((await afterStart.taskBilling.claimProviderDispatch(afterStartInput)).ok, true);
  const started = await afterStart.taskBilling.markProviderStarted({
    localUserId: "local-user",
    taskId: "dispatch-after-start",
    upstreamModel: "image-model",
  });
  assert.equal(started.ok, true);
  const staleStarted = await afterStart.taskRepository.getByTaskId("local-user", "dispatch-after-start");
  assert.ok(staleStarted);
  await afterStart.taskRepository.update(staleStarted.id, {
    updated_at: "2026-06-17T23:50:00.000Z",
  }, staleStarted.version);
  const reconciled = await afterStart.taskBilling.claimProviderDispatch(afterStartInput);
  assert.equal(reconciled.ok, true);
  if (!reconciled.ok) return;
  assert.equal(reconciled.action, "reconciliation_required");
  assert.equal(reconciled.record.billing_state, "reconciliation_required");
});

test("stale provider dispatches restore unconfirmed entitlements and retain upstream tasks for reconciliation", async () => {
  const harness = service();
  await harness.membershipService.applyPaidMembership({
    localUserId: "local-user",
    orderId: "stale-provider-membership",
    planId: "basic",
    cycle: "monthly",
    now: new Date("2026-06-18T00:00:00.000Z"),
  });

  const unconfirmed = {
    localUserId: "local-user",
    taskId: "stale-unconfirmed-provider-task",
    operation: "cloud_image_generation" as const,
    estimatedQuotaUnits: 40,
    idempotencyKey: "stale-unconfirmed-provider-task",
  };
  assert.equal((await harness.taskBilling.precheck(unconfirmed)).ok, true);
  assert.equal((await harness.taskBilling.claimProviderDispatch(unconfirmed)).ok, true);
  assert.equal((await harness.taskBilling.markProviderStarted({
    localUserId: unconfirmed.localUserId,
    taskId: unconfirmed.taskId,
  })).ok, true);

  const confirmed = { ...unconfirmed, taskId: "stale-confirmed-provider-task", idempotencyKey: "stale-confirmed-provider-task" };
  assert.equal((await harness.taskBilling.precheck(confirmed)).ok, true);
  assert.equal((await harness.taskBilling.claimProviderDispatch(confirmed)).ok, true);
  assert.equal((await harness.taskBilling.markProviderStarted({
    localUserId: confirmed.localUserId,
    taskId: confirmed.taskId,
    newApiTaskId: "upstream-task-1",
  })).ok, true);

  for (const taskId of [unconfirmed.taskId, confirmed.taskId]) {
    const record = await harness.taskRepository.getByTaskId("local-user", taskId);
    assert.ok(record);
    await harness.taskRepository.update(record.id, { updated_at: "2026-06-17T23:40:00.000Z" }, record.version);
  }

  const result = await harness.taskBilling.reconcileStaleProviderDispatches();
  assert.deepEqual(result, { scanned: 2, failedAndRestored: 1, reconciliationRequired: 1, skipped: 0 });
  assert.equal((await harness.taskRepository.getByTaskId("local-user", unconfirmed.taskId))?.billing_state, "failed");
  assert.equal((await harness.taskRepository.getByTaskId("local-user", confirmed.taskId))?.billing_state, "reconciliation_required");
  const status = await harness.membershipService.getStatus("local-user");
  assert.equal(status.entitlements.image_generation.remaining, 10);
});

test("precheck retries reject mismatched request parameters", async () => {
  const harness = service();
  const first = await harness.taskBilling.precheck({
    localUserId: "local-user",
    taskId: "same-task",
    operation: "cloud_image_generation",
    estimatedQuotaUnits: 40,
    idempotencyKey: "same-task",
    requestFingerprint: "image:same-task:40",
  });
  assert.equal(first.ok, true);

  const changed = await harness.taskBilling.precheck({
    localUserId: "local-user",
    taskId: "same-task",
    operation: "cloud_image_generation",
    estimatedQuotaUnits: 80,
    idempotencyKey: "same-task",
    requestFingerprint: "image:same-task:80",
  });
  assert.equal(changed.ok, false);
  if (changed.ok) return;
  assert.equal(changed.code, "task_billing_conflict");
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

test("same user concurrent task settlements are serialized without lost quota updates", async () => {
  let quota = 100;
  const calls: string[] = [];
  const harness = service({
    adjustQuota: async (input) => {
      const before = quota;
      await new Promise((resolve) => {
        setImmediate(resolve);
      });
      quota = before + input.quotaDelta;
      calls.push(`${input.taskId}:${before}->${quota}`);
      return { ok: true, providerAdjustmentId: `adjust:${input.idempotencyKey}` };
    },
  });
  await precheckAndAccept(harness, "task-concurrent-a");
  await precheckAndAccept(harness, "task-concurrent-b");

  const [first, second] = await Promise.all([
    harness.taskBilling.settleSuccess({
      localUserId: "local-user",
      taskId: "task-concurrent-a",
      actualQuotaUnits: 6,
    }),
    harness.taskBilling.settleSuccess({
      localUserId: "local-user",
      taskId: "task-concurrent-b",
      actualQuotaUnits: 4,
    }),
  ]);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(quota, 90);
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

test("local write failure after quota adjustment recovers without duplicate charge", async () => {
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
  assert.equal(retry.action, "settled");
  assert.equal(retry.record.billing_state, "settled");
  assert.equal(harness.adjustments.length, 1);
  assert.equal(JSON.stringify(first).includes("secret-token"), false);
  assert.equal(JSON.stringify(first).includes("hidden"), false);
});

test("settlement failure leaves a reconciliation record", async () => {
  const harness = service({
    adjustQuota: async () => ({
      ok: false,
      code: "NEW_API_DOWN",
      message: "New API quota adjustment failed token=hidden",
      retryable: true,
    }),
  });
  await precheckAndAccept(harness, "task-settlement-failure");

  const result = await harness.taskBilling.settleSuccess({
    localUserId: "local-user",
    taskId: "task-settlement-failure",
    actualQuotaUnits: 6,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.action, "reconciliation_required");
  assert.equal(result.record.billing_state, "reconciliation_required");
  assert.equal(result.record.last_error?.includes("hidden"), false);
  const usage = await harness.usageRepository.getByTaskId("local-user", "task-settlement-failure");
  assert.equal(usage?.status, "reconciliation_required");
});

test("interrupted provider charge is recovered from target quota without duplicate debit", async () => {
  const taskRepository = createMemoryTaskBillingRepository();
  const harness = service({ repository: taskRepository, providerQuota: 100 });
  await precheckAndAccept(harness, "task-provider-crash");
  const originalApplied = taskRepository.markQuotaAdjustmentApplied?.bind(taskRepository);
  let failApplied = true;
  taskRepository.markQuotaAdjustmentApplied = async (idempotencyKey, providerAdjustmentId, now) => {
    if (failApplied) {
      failApplied = false;
      throw new Error("simulated crash before local applied marker token=hidden");
    }
    return originalApplied!(idempotencyKey, providerAdjustmentId, now);
  };

  const first = await harness.taskBilling.settleSuccess({
    localUserId: "local-user",
    taskId: "task-provider-crash",
    actualQuotaUnits: 11,
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.action, "reconciliation_required");
  assert.equal(harness.providerQuota, 89);
  assert.equal(harness.adjustments.length, 1);

  const retry = await harness.taskBilling.settleSuccess({
    localUserId: "local-user",
    taskId: "task-provider-crash",
    actualQuotaUnits: 11,
  });

  assert.equal(retry.ok, true);
  if (!retry.ok) return;
  assert.equal(retry.action, "settled");
  assert.equal(harness.providerQuota, 89);
  assert.equal(harness.adjustments.length, 1);
});

test("interrupted provider refund is recovered from target quota without duplicate credit", async () => {
  const taskRepository = createMemoryTaskBillingRepository();
  const harness = service({ repository: taskRepository, providerQuota: 100 });
  await precheckAndAccept(harness, "task-refund-crash");
  const settled = await harness.taskBilling.settleSuccess({
    localUserId: "local-user",
    taskId: "task-refund-crash",
    actualQuotaUnits: 8,
  });
  assert.equal(settled.ok, true);
  assert.equal(harness.providerQuota, 92);
  const originalApplied = taskRepository.markQuotaAdjustmentApplied?.bind(taskRepository);
  let failRefundApplied = true;
  taskRepository.markQuotaAdjustmentApplied = async (idempotencyKey, providerAdjustmentId, now) => {
    if (idempotencyKey.startsWith("task-refund:") && failRefundApplied) {
      failRefundApplied = false;
      throw new Error("simulated crash before refund applied marker secret=hidden");
    }
    return originalApplied!(idempotencyKey, providerAdjustmentId, now);
  };

  const failed = await harness.taskBilling.fail({
    localUserId: "local-user",
    taskId: "task-refund-crash",
    reason: "provider failed after debit",
  });
  assert.equal(failed.ok, true);
  if (!failed.ok) return;
  assert.equal(failed.action, "reconciliation_required");
  assert.equal(harness.providerQuota, 100);
  assert.deepEqual(harness.adjustments.map((input) => input.quotaDelta), [-8, 8]);

  const retry = await harness.taskBilling.fail({
    localUserId: "local-user",
    taskId: "task-refund-crash",
    reason: "provider failed after debit",
  });

  assert.equal(retry.ok, true);
  if (!retry.ok) return;
  assert.equal(retry.action, "refunded");
  assert.equal(harness.providerQuota, 100);
  assert.deepEqual(harness.adjustments.map((input) => input.quotaDelta), [-8, 8]);
});

test("unknown provider quota change enters reconciliation without automatic overwrite", async () => {
  const taskRepository = createMemoryTaskBillingRepository();
  const harness = service({ repository: taskRepository, providerQuota: 100 });
  await precheckAndAccept(harness, "task-provider-unknown");
  const originalApplied = taskRepository.markQuotaAdjustmentApplied?.bind(taskRepository);
  let failApplied = true;
  taskRepository.markQuotaAdjustmentApplied = async (idempotencyKey, providerAdjustmentId, now) => {
    if (failApplied) {
      failApplied = false;
      throw new Error("simulated crash before local applied marker");
    }
    return originalApplied!(idempotencyKey, providerAdjustmentId, now);
  };

  const first = await harness.taskBilling.settleSuccess({
    localUserId: "local-user",
    taskId: "task-provider-unknown",
    actualQuotaUnits: 10,
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.action, "reconciliation_required");
  assert.equal(harness.providerQuota, 90);
  harness.providerQuota = 95;

  const retry = await harness.taskBilling.settleSuccess({
    localUserId: "local-user",
    taskId: "task-provider-unknown",
    actualQuotaUnits: 10,
  });

  assert.equal(retry.ok, true);
  if (!retry.ok) return;
  assert.equal(retry.action, "reconciliation_required");
  assert.equal(retry.record.billing_state, "reconciliation_required");
  assert.equal(harness.providerQuota, 95);
  assert.equal(harness.adjustments.length, 1);
});

async function resetTaskBillingTables() {
  await applicationQuery("truncate table audit_events, task_quota_adjustments, task_billing_records, usage_records, billing_idempotency_keys, billing_webhook_events, billing_orders, new_api_user_mappings, auth_sessions, app_users restart identity cascade");
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
    usageRepository: createPostgresUsageLogRepository(),
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
  const usageRows = await applicationQuery<{ status: string }>(
    "select status from usage_records where local_user_id = $1 and task_id = 'pg-task'",
    [localUserId],
  );
  const adjustmentRows = await applicationQuery<{ status: string }>(
    "select status from task_quota_adjustments where local_user_id = $1 and task_id = 'pg-task'",
    [localUserId],
  );
  assert.equal(rows.rows[0]?.billing_state, "settled");
  assert.equal(Number(rows.rows[0]?.final_quota_units), 8);
  assert.equal(rows.rows[0]?.new_api_task_id, "new-api-pg-task");
  assert.equal(usageRows.rows[0]?.status, "succeeded");
  assert.equal(adjustmentRows.rows[0]?.status, "applied");
});

dbTest("task billing postgres persistence mode does not read or write JSON repositories", async () => {
  await resetTaskBillingTables();
  const previousMode = process.env.APP_TASK_BILLING_PERSISTENCE_MODE;
  const localUserId = "55555555-5555-4555-8555-555555555555";
  try {
    process.env.APP_TASK_BILLING_PERSISTENCE_MODE = "postgres";
    await seedPostgresUser(localUserId);
    await seedPostgresMapping(localUserId, "9501");
    const persistence = createTaskBillingPersistenceRepositories();
    const taskBilling = new TaskBillingService({
      ...persistence,
      now: () => new Date("2026-06-18T00:00:00.000Z"),
      getQuotaSnapshot: async () => ({ ok: true, snapshot: snapshot(100, localUserId, "9501") }),
      adjustQuota: async (input) => ({ ok: true, providerAdjustmentId: `adjust:${input.idempotencyKey}` }),
    });

    const prechecked = await taskBilling.precheck({
      localUserId,
      taskId: "pg-mode-task",
      operation: "cloud_image_generation",
      estimatedQuotaUnits: 5,
      idempotencyKey: "pg-mode-idem",
    });
    assert.equal(prechecked.ok, true);
    const settled = await taskBilling.settleSuccess({
      localUserId,
      taskId: "pg-mode-task",
      actualQuotaUnits: 5,
    });
    assert.equal(settled.ok, true);
    const rows = await applicationQuery<{ count: string }>(
      "select count(*)::text as count from task_billing_records where local_user_id = $1",
      [localUserId],
    );
    assert.equal(rows.rows[0]?.count, "1");
  } finally {
    if (previousMode === undefined) delete process.env.APP_TASK_BILLING_PERSISTENCE_MODE;
    else process.env.APP_TASK_BILLING_PERSISTENCE_MODE = previousMode;
  }
});

test("production task billing persistence mode fails closed when missing or invalid", () => {
  const previousMode = process.env.APP_TASK_BILLING_PERSISTENCE_MODE;
  const previousNodeEnv = process.env.NODE_ENV;
  try {
    delete process.env.APP_TASK_BILLING_PERSISTENCE_MODE;
    Reflect.set(process.env, "NODE_ENV", "production");
    assert.throws(() => createTaskBillingPersistenceRepositories(), TaskBillingPersistenceConfigError);
    process.env.APP_TASK_BILLING_PERSISTENCE_MODE = "dual";
    assert.throws(() => createTaskBillingPersistenceRepositories(), TaskBillingPersistenceConfigError);
  } finally {
    if (previousMode === undefined) delete process.env.APP_TASK_BILLING_PERSISTENCE_MODE;
    else process.env.APP_TASK_BILLING_PERSISTENCE_MODE = previousMode;
    if (previousNodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
    else Reflect.set(process.env, "NODE_ENV", previousNodeEnv);
  }
});

test.after(async () => {
  await closeApplicationDatabasePool();
});
