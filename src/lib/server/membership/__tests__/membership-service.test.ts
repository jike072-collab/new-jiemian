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
  assert.equal(status.entitlements.image_generation.remaining, 180);
  assert.equal(status.entitlements.video_generation.remaining, 3);
  assert.equal(status.entitlements.image_edit.remaining, 180);
  assert.equal(status.entitlements.image_upscale.remaining, 180);
  assert.equal(status.entitlements.video_upscale.remaining, 3);
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
  const membership = new MembershipService({
    repository,
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
