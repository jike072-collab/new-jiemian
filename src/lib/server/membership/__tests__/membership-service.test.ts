import assert from "node:assert/strict";
import { test } from "node:test";

import { createMemoryMembershipRepository } from "../repository";
import { MembershipService } from "../service";

function service(now = "2026-06-18T00:00:00.000Z") {
  return new MembershipService({
    repository: createMemoryMembershipRepository(),
    now: () => new Date(now),
  });
}

test("grants paid membership credits and entitlement counts by cycle", async () => {
  const membership = service();
  const record = await membership.applyPaidMembership({
    localUserId: "user-1",
    orderId: "order-advanced-quarterly",
    planId: "advanced",
    cycle: "quarterly",
  });
  assert.equal(record.plan_id, "advanced");
  assert.equal(record.cycle, "quarterly");
  assert.equal(record.status, "active");

  const status = await membership.getStatus("user-1");
  assert.equal(status.active?.source_order_id, "order-advanced-quarterly");
  assert.equal(status.recharge_bonus_basis_points, 1000);
  assert.equal(status.first_purchase_reward_claimed, true);
  assert.equal(status.entitlements.prompt_optimize.remaining, 99);
  assert.equal(status.entitlements.image_generation.remaining, 99);
  assert.equal(status.entitlements.video_generation.remaining, 4);
  assert.equal(status.entitlements.image_edit.remaining, 0);
  assert.equal(status.entitlements.image_upscale.remaining, 99);
  assert.equal(status.entitlements.video_upscale.remaining, 4);
});

test("keeps the basic plan regular entitlement counts unchanged across cycles", async () => {
  const membership = service();
  const yearly = membership.getSku("basic", "yearly");
  assert.equal(yearly?.grant_credits, 43_200);
  assert.equal(yearly?.grant_entitlements.image_generation, 120);
  assert.equal(yearly?.grant_entitlements.prompt_optimize, 120);
  assert.equal(yearly?.cycle_bonus_basis_points, 0);
});

test("backfills only missing entitlement kinds for an active membership", async () => {
  const repository = createMemoryMembershipRepository();
  await repository.createMembership({
    localUserId: "legacy-user",
    planId: "pro",
    cycle: "monthly",
    status: "active",
    startsAt: "2026-06-18T00:00:00.000Z",
    endsAt: "2026-07-18T00:00:00.000Z",
    sourceOrderId: "legacy-order",
    now: "2026-06-18T00:00:00.000Z",
  });
  for (const [kind, amount] of [["prompt_optimize", 80], ["image_generation", 60], ["video_generation", 3]] as const) {
    await repository.grantEntitlement({
      localUserId: "legacy-user",
      kind,
      amount,
      sourceOrderId: "legacy-order",
      expiresAt: "2026-07-18T00:00:00.000Z",
      idempotencyKey: `legacy-v1:legacy-order:${kind}`,
      now: "2026-06-18T00:00:00.000Z",
    });
  }
  const membership = new MembershipService({
    repository,
    now: () => new Date("2026-06-18T00:00:00.000Z"),
  });
  const status = await membership.getStatus("legacy-user");
  assert.equal(status.entitlements.prompt_optimize.remaining, 80);
  assert.equal(status.entitlements.image_generation.remaining, 60);
  assert.equal(status.entitlements.video_generation.remaining, 3);
  assert.equal(status.entitlements.image_edit.remaining, 0);
  assert.equal(status.entitlements.image_upscale.remaining, 60);
  assert.equal(status.entitlements.video_upscale.remaining, 3);
});

test("does not partially consume a multi-image entitlement request", async () => {
  const membership = service();
  await membership.applyPaidMembership({
    localUserId: "user-partial",
    orderId: "order-basic-partial",
    planId: "basic",
    cycle: "monthly",
  });
  const first = await membership.consumeEntitlement({
    localUserId: "user-partial",
    kind: "image_generation",
    amount: 8,
    idempotencyKey: "consume-eight",
  });
  assert.equal(first.consumed, 8);
  const rejected = await membership.consumeEntitlement({
    localUserId: "user-partial",
    kind: "image_generation",
    amount: 4,
    idempotencyKey: "consume-four",
  });
  assert.equal(rejected.consumed, 0);
  const status = await membership.getStatus("user-partial");
  assert.equal(status.entitlements.image_generation.remaining, 3);
});

test("same tier renews, higher tier activates immediately, lower tier queues", async () => {
  const membership = service();
  const first = await membership.applyPaidMembership({
    localUserId: "user-1",
    orderId: "order-basic-1",
    planId: "basic",
    cycle: "monthly",
  });
  const renewed = await membership.applyPaidMembership({
    localUserId: "user-1",
    orderId: "order-basic-2",
    planId: "basic",
    cycle: "monthly",
  });
  assert.equal(renewed.status, "queued");
  assert.equal(renewed.starts_at, first.ends_at);

  const upgraded = await membership.applyPaidMembership({
    localUserId: "user-1",
    orderId: "order-pro",
    planId: "pro",
    cycle: "monthly",
  });
  assert.equal(upgraded.status, "active");
  assert.equal((await membership.getStatus("user-1")).active?.plan_id, "pro");

  const lower = await membership.applyPaidMembership({
    localUserId: "user-1",
    orderId: "order-basic-later",
    planId: "basic",
    cycle: "monthly",
  });
  assert.equal(lower.status, "queued");
  assert.equal(lower.starts_at, renewed.ends_at);

  const afterPro = await membership.getStatus("user-1", new Date(upgraded.ends_at));
  assert.equal(afterPro.active?.source_order_id, "order-basic-2");
});

test("mirrors external New API membership into the local repository", async () => {
  const repository = createMemoryMembershipRepository();
  const fulfillmentCalls: Array<{
    localUserId: string;
    sourceOrderId: string;
    planId: string;
    cycle: string;
    startsAt: string;
  }> = [];
  const membership = new MembershipService({
    repository,
    externalMembershipFulfillment: async (input) => {
      fulfillmentCalls.push(input);
    },
    externalStatus: async () => ({
      active: {
        id: "new-api-subscription:mirror-1",
        local_user_id: "user-2",
        plan_id: "pro",
        cycle: "monthly",
        status: "active",
        starts_at: "2026-06-18T00:00:00.000Z",
        ends_at: "2026-07-18T00:00:00.000Z",
        source_order_id: "new-api-subscription:mirror-1",
        created_at: "2026-06-18T00:00:00.000Z",
        updated_at: "2026-06-18T00:00:00.000Z",
        cancelled_at: null,
        version: 1,
      },
      queued: null,
      recharge_bonus_basis_points: 0,
      first_purchase_reward_claimed: false,
      entitlements: {
        prompt_optimize: { remaining: 3, granted: 3, used: 0 },
        image_generation: { remaining: 4, granted: 4, used: 0 },
        video_generation: { remaining: 1, granted: 1, used: 0 },
        image_edit: { remaining: 2, granted: 2, used: 0 },
        image_upscale: { remaining: 2, granted: 2, used: 0 },
        video_upscale: { remaining: 1, granted: 1, used: 0 },
      },
    }),
    now: () => new Date("2026-06-18T00:00:00.000Z"),
  });

  const status = await membership.getStatus("user-2");
  assert.equal(status.active?.plan_id, "pro");
  assert.equal((await repository.listMemberships("user-2")).length, 1);
  assert.equal((await repository.listEntitlements("user-2")).length, 6);
  assert.deepEqual(fulfillmentCalls[0], {
    localUserId: "user-2",
    sourceOrderId: "new-api-subscription:mirror-1",
    planId: "pro",
    cycle: "monthly",
    startsAt: "2026-06-18T00:00:00.000Z",
  });

  await membership.getStatus("user-2");
  assert.equal(fulfillmentCalls.length, 2);

  const consumed = await membership.consumeEntitlement({
    localUserId: "user-2",
    kind: "image_generation",
    amount: 1,
    idempotencyKey: "mirror-consume",
  });
  assert.equal(consumed.consumed, 1);
});

test("replaces a stale active NewAPI subscription with the current external subscription", async () => {
  const repository = createMemoryMembershipRepository();
  await repository.createMembership({
    localUserId: "external-renewal-user",
    planId: "enterprise",
    cycle: "monthly",
    status: "active",
    startsAt: "2026-07-13T06:33:38.000Z",
    endsAt: "2026-08-13T06:33:38.000Z",
    sourceOrderId: "new-api-subscription:5",
    now: "2026-07-13T06:33:38.000Z",
  });
  await repository.grantEntitlement({
    localUserId: "external-renewal-user",
    kind: "video_generation",
    amount: 8,
    sourceOrderId: "new-api-subscription:5",
    expiresAt: "2026-08-13T06:33:38.000Z",
    idempotencyKey: "old-video-grant",
    now: "2026-07-13T06:33:38.000Z",
  });
  let externalCalls = 0;
  const membership = new MembershipService({
    repository,
    externalMembershipFulfillment: async () => undefined,
    externalStatus: async () => {
      externalCalls += 1;
      return {
        active: {
          id: "new-api-subscription:8",
          local_user_id: "external-renewal-user",
          plan_id: "enterprise",
          cycle: "yearly",
          status: "active",
          starts_at: "2026-07-15T08:10:46.000Z",
          ends_at: "2027-07-15T08:10:46.000Z",
          source_order_id: "new-api-subscription:8",
          created_at: "2026-07-15T08:10:45.000Z",
          updated_at: "2026-07-15T08:10:45.000Z",
          cancelled_at: null,
          version: 1,
        },
        queued: null,
        recharge_bonus_basis_points: 2_000,
        first_purchase_reward_claimed: false,
        entitlements: {
          prompt_optimize: { remaining: 2_400, granted: 2_400, used: 0 },
          image_generation: { remaining: 1_800, granted: 1_800, used: 0 },
          video_generation: { remaining: 96, granted: 96, used: 0 },
          image_edit: { remaining: 0, granted: 0, used: 0 },
          image_upscale: { remaining: 1_800, granted: 1_800, used: 0 },
          video_upscale: { remaining: 96, granted: 96, used: 0 },
        },
      };
    },
    now: () => new Date("2026-07-15T08:20:00.000Z"),
  });

  const status = await membership.getStatus("external-renewal-user");
  assert.equal(status.active?.source_order_id, "new-api-subscription:8");
  assert.equal(status.active?.cycle, "yearly");
  assert.equal(status.entitlements.video_generation.remaining, 96);
  const memberships = await repository.listMemberships("external-renewal-user");
  assert.equal(memberships.find((item) => item.source_order_id === "new-api-subscription:5")?.status, "cancelled");
  assert.equal(memberships.find((item) => item.source_order_id === "new-api-subscription:8")?.status, "active");
  const entitlements = await repository.listEntitlements("external-renewal-user", "2026-07-15T08:20:00.000Z");
  assert(entitlements.every((item) => item.source_order_id === "new-api-subscription:8"));
  assert.equal(externalCalls, 1);
});

test("mirrors a queued NewAPI renewal without replacing the current month", async () => {
  const repository = createMemoryMembershipRepository();
  await repository.createMembership({
    localUserId: "external-queued-renewal",
    planId: "enterprise",
    cycle: "monthly",
    status: "active",
    startsAt: "2026-07-13T06:33:38.000Z",
    endsAt: "2026-08-13T06:33:38.000Z",
    sourceOrderId: "new-api-subscription:5",
    now: "2026-07-13T06:33:38.000Z",
  });
  const membership = new MembershipService({
    repository,
    externalMembershipFulfillment: async () => undefined,
    externalStatus: async () => ({
      active: {
        id: "new-api-subscription:5",
        local_user_id: "external-queued-renewal",
        plan_id: "enterprise",
        cycle: "monthly",
        status: "active",
        starts_at: "2026-07-13T06:33:38.000Z",
        ends_at: "2026-08-13T06:33:38.000Z",
        source_order_id: "new-api-subscription:5",
        created_at: "2026-07-13T06:33:38.000Z",
        updated_at: "2026-07-15T08:20:00.000Z",
        cancelled_at: null,
        version: 1,
      },
      queued: {
        id: "new-api-subscription:9",
        local_user_id: "external-queued-renewal",
        plan_id: "enterprise",
        cycle: "monthly",
        status: "queued",
        starts_at: "2026-08-13T06:33:38.000Z",
        ends_at: "2026-09-13T06:33:38.000Z",
        source_order_id: "new-api-subscription:9",
        created_at: "2026-07-15T08:10:45.000Z",
        updated_at: "2026-07-15T08:10:45.000Z",
        cancelled_at: null,
        version: 1,
      },
      recharge_bonus_basis_points: 2_000,
      first_purchase_reward_claimed: false,
      entitlements: {
        prompt_optimize: { remaining: 200, granted: 200, used: 0 },
        image_generation: { remaining: 150, granted: 150, used: 0 },
        video_generation: { remaining: 8, granted: 8, used: 0 },
        image_edit: { remaining: 0, granted: 0, used: 0 },
        image_upscale: { remaining: 150, granted: 150, used: 0 },
        video_upscale: { remaining: 8, granted: 8, used: 0 },
      },
    }),
    now: () => new Date("2026-07-15T08:20:00.000Z"),
  });

  const status = await membership.getStatus("external-queued-renewal");
  assert.equal(status.active?.source_order_id, "new-api-subscription:5");
  assert.equal(status.queued?.source_order_id, "new-api-subscription:9");
  assert.equal(status.queued?.starts_at, status.active?.ends_at);
});

test("grants one renewal when the same NewAPI subscription extends", async () => {
  const repository = createMemoryMembershipRepository();
  await repository.createMembership({
    localUserId: "external-extended-renewal",
    planId: "enterprise",
    cycle: "monthly",
    status: "active",
    startsAt: "2026-07-13T06:33:38.000Z",
    endsAt: "2026-08-13T06:33:38.000Z",
    sourceOrderId: "new-api-subscription:5",
    now: "2026-07-13T06:33:38.000Z",
  });
  await repository.grantEntitlement({
    localUserId: "external-extended-renewal",
    kind: "video_generation",
    amount: 8,
    sourceOrderId: "new-api-subscription:5",
    expiresAt: "2026-08-13T06:33:38.000Z",
    idempotencyKey: "new-api-mirror:new-api-subscription:5:video_generation",
    now: "2026-07-13T06:33:38.000Z",
  });
  let currentTime = new Date("2026-07-15T08:20:00.000Z");
  const membership = new MembershipService({
    repository,
    externalMembershipFulfillment: async () => undefined,
    externalStatus: async () => ({
      active: {
        id: "new-api-subscription:5",
        local_user_id: "external-extended-renewal",
        plan_id: "enterprise",
        cycle: "monthly",
        status: "active",
        starts_at: "2026-07-13T06:33:38.000Z",
        ends_at: "2026-09-13T06:33:38.000Z",
        source_order_id: "new-api-subscription:5",
        created_at: "2026-07-13T06:33:38.000Z",
        updated_at: currentTime.toISOString(),
        cancelled_at: null,
        version: 2,
      },
      queued: null,
      recharge_bonus_basis_points: 2_000,
      first_purchase_reward_claimed: false,
      entitlements: {
        prompt_optimize: { remaining: 200, granted: 200, used: 0 },
        image_generation: { remaining: 150, granted: 150, used: 0 },
        video_generation: { remaining: 8, granted: 8, used: 0 },
        image_edit: { remaining: 0, granted: 0, used: 0 },
        image_upscale: { remaining: 150, granted: 150, used: 0 },
        video_upscale: { remaining: 8, granted: 8, used: 0 },
      },
    }),
    now: () => currentTime,
  });

  const extended = await membership.getStatus("external-extended-renewal");
  assert.equal(extended.active?.ends_at, "2026-09-13T06:33:38.000Z");
  assert.equal(extended.entitlements.video_generation.remaining, 16);
  currentTime = new Date("2026-07-15T08:21:00.000Z");
  const repeated = await membership.getStatus("external-extended-renewal");
  assert.equal(repeated.entitlements.video_generation.remaining, 16);
});

test("restores consumed entitlements for failed generation flows", async () => {
  const repository = createMemoryMembershipRepository();
  const membership = new MembershipService({
    repository,
    now: () => new Date("2026-06-18T00:00:00.000Z"),
  });
  await membership.applyPaidMembership({
    localUserId: "user-3",
    orderId: "order-pro-monthly",
    planId: "pro",
    cycle: "monthly",
  });

  const consumed = await membership.consumeEntitlement({
    localUserId: "user-3",
    kind: "image_generation",
    amount: 1,
    idempotencyKey: "task-failed",
    taskId: "task-failed",
  });
  assert.equal(consumed.consumed, 1);

  const restored = await membership.restoreEntitlement({
    localUserId: "user-3",
    kind: "image_generation",
    amount: 1,
    idempotencyKey: "restore-task-failed",
    taskId: "task-failed",
  });
  assert.equal(restored.restored, 1);
  const status = await membership.getStatus("user-3");
  assert.equal(status.entitlements.image_generation.remaining, 64);
});

test("first paid membership reward is owned by one order and grows by tier and cycle", async () => {
  const membership = service();
  const basicMonthly = await membership.claimFirstPurchaseReward({
    localUserId: "first-basic",
    orderId: "basic-monthly",
    planId: "basic",
    cycle: "monthly",
  });
  const enterpriseYearly = await membership.claimFirstPurchaseReward({
    localUserId: "first-enterprise",
    orderId: "enterprise-yearly",
    planId: "enterprise",
    cycle: "yearly",
  });
  assert.equal(basicMonthly.isOwner, true);
  assert.equal(enterpriseYearly.isOwner, true);
  assert.ok(enterpriseYearly.reward.bonus_credits > basicMonthly.reward.bonus_credits);
  assert.ok(enterpriseYearly.reward.bonus_entitlements.image_generation > basicMonthly.reward.bonus_entitlements.image_generation);

  const retry = await membership.claimFirstPurchaseReward({
    localUserId: "first-basic",
    orderId: "basic-monthly",
    planId: "basic",
    cycle: "monthly",
  });
  const later = await membership.claimFirstPurchaseReward({
    localUserId: "first-basic",
    orderId: "basic-yearly-later",
    planId: "basic",
    cycle: "yearly",
  });
  assert.equal(retry.isOwner, true);
  assert.equal(later.isOwner, false);
  assert.equal(later.reward.source_order_id, "basic-monthly");
});

test("manual membership does not consume the paid first-purchase reward", async () => {
  const membership = service();
  await membership.applyManualMembership({
    localUserId: "manual-first",
    orderId: "admin-membership:manual-first:one",
    planId: "basic",
    cycle: "monthly",
  });
  assert.equal((await membership.getStatus("manual-first")).first_purchase_reward_claimed, false);
  const paid = await membership.claimFirstPurchaseReward({
    localUserId: "manual-first",
    orderId: "paid-after-manual",
    planId: "advanced",
    cycle: "quarterly",
  });
  assert.equal(paid.isOwner, true);
});

test("manual renewal of the current plan starts after its existing term", async () => {
  const membership = service();
  const first = await membership.applyManualMembership({
    localUserId: "manual-renewal",
    orderId: "admin-membership:manual-renewal:one",
    planId: "enterprise",
    cycle: "monthly",
  });
  const second = await membership.applyManualMembership({
    localUserId: "manual-renewal",
    orderId: "admin-membership:manual-renewal:two",
    planId: "enterprise",
    cycle: "monthly",
  });

  assert.equal(first.status, "active");
  assert.equal(second.status, "queued");
  assert.equal(second.starts_at, first.ends_at);
  assert.equal((await membership.getStatus("manual-renewal")).active?.source_order_id, first.source_order_id);
});
