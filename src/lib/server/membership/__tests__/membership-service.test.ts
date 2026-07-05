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
