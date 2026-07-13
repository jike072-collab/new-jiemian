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
  assert.equal(status.entitlements.prompt_optimize.remaining, 90);
  assert.equal(status.entitlements.image_generation.remaining, 90);
  assert.equal(status.entitlements.video_generation.remaining, 3);
  assert.equal(status.entitlements.image_edit.remaining, 0);
  assert.equal(status.entitlements.image_upscale.remaining, 90);
  assert.equal(status.entitlements.video_upscale.remaining, 3);
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
  assert.equal(status.entitlements.image_generation.remaining, 2);
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
  assert.equal(status.entitlements.image_generation.remaining, 60);
});
