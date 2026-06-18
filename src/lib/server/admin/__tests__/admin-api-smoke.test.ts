import assert from "node:assert/strict";
import { test } from "node:test";

import { createAdminService, type AdminActor } from "../service";
import { createMemoryAuthRepository } from "../../auth";
import { createMemoryBillingRepository, type BillingOrder } from "../../billing";
import { createMemoryNewApiUserMappingRepository, type NewApiUserMapping } from "../../integrations/new-api";
import { createMemoryTaskBillingRepository, type TaskBillingRecord } from "../../quota";
import { type TaskQuotaAdjustment } from "../../quota/task-billing-repository";

const adminActor: AdminActor = {
  localUserId: "admin-user",
  role: "admin",
};

function now() {
  return new Date("2026-06-19T00:00:00.000Z");
}

function mapping(localUserId = "target-user", newApiUserId = "100"): NewApiUserMapping {
  return {
    local_user_id: localUserId,
    new_api_user_id: newApiUserId,
    sync_status: "active",
    created_at: "2026-06-19T00:00:00.000Z",
    updated_at: "2026-06-19T00:00:00.000Z",
    last_sync_at: "2026-06-19T00:00:00.000Z",
    last_error_code: null,
    last_error_message: null,
    retry_count: 0,
    version: 1,
    idempotency_key: `mapping:${localUserId}`,
  };
}

function order(input: Partial<BillingOrder> = {}): BillingOrder {
  return {
    order_id: input.order_id || "bo_admin",
    local_user_id: input.local_user_id || "target-user",
    new_api_user_id: input.new_api_user_id || "100",
    channel: input.channel || "sandbox",
    currency: input.currency || "CNY",
    requested_amount: input.requested_amount ?? 1000,
    paid_amount: input.paid_amount ?? 0,
    credited_quota: input.credited_quota ?? 1000,
    status: input.status || "review",
    idempotency_key: input.idempotency_key || "order-key",
    provider_order_id: input.provider_order_id || "sandbox_bo_admin",
    created_at: input.created_at || "2026-06-19T00:00:00.000Z",
    updated_at: input.updated_at || "2026-06-19T00:00:00.000Z",
    paid_at: input.paid_at ?? null,
    last_error: input.last_error ?? null,
    version: input.version ?? 1,
    quota_credit_applied_at: input.quota_credit_applied_at ?? null,
    refunded_at: input.refunded_at ?? null,
    webhook_event_ids: input.webhook_event_ids || [],
  };
}

function taskRecord(input: Partial<TaskBillingRecord> = {}): TaskBillingRecord {
  return {
    id: input.id || "task-record-1",
    local_user_id: input.local_user_id || "target-user",
    task_id: input.task_id || "task-1",
    new_api_task_id: input.new_api_task_id ?? null,
    usage_record_id: input.usage_record_id ?? null,
    idempotency_key: input.idempotency_key || "task-key",
    billing_state: input.billing_state || "reconciliation_required",
    estimated_quota_units: input.estimated_quota_units ?? 100,
    final_quota_units: input.final_quota_units ?? null,
    created_at: input.created_at || "2026-06-19T00:00:00.000Z",
    updated_at: input.updated_at || "2026-06-19T00:00:00.000Z",
    settled_at: input.settled_at ?? null,
    refunded_at: input.refunded_at ?? null,
    last_error: input.last_error ?? "needs review",
    version: input.version ?? 1,
  };
}

function harness() {
  let providerQuota = 1000;
  const authRepository = createMemoryAuthRepository({
    users: [
      {
        local_user_id: "admin-user",
        email: "admin@example.com",
        username: "admin",
        display_name: "Admin",
        password_hash: "hash",
        status: "active",
        role: "admin",
        session_version: 1,
        created_at: "2026-06-19T00:00:00.000Z",
        updated_at: "2026-06-19T00:00:00.000Z",
        last_login_at: null,
      },
      {
        local_user_id: "target-user",
        email: "target@example.com",
        username: "target",
        display_name: "Target",
        password_hash: "hash",
        status: "active",
        role: "user",
        session_version: 1,
        created_at: "2026-06-19T00:00:00.000Z",
        updated_at: "2026-06-19T00:00:00.000Z",
        last_login_at: null,
      },
    ],
  });
  const mappingRepository = createMemoryNewApiUserMappingRepository([mapping()]);
  const billingRepository = createMemoryBillingRepository({ orders: [order()] });
  const taskRepository = createMemoryTaskBillingRepository([taskRecord()]);
  const service = createAdminService({
    authRepository,
    mappingRepository,
    billingRepository,
    taskRepository,
    getProviderQuota: async () => providerQuota,
    setProviderQuota: async (_newApiUserId, quota) => {
      providerQuota = quota;
    },
    now,
  });
  return {
    service,
    authRepository,
    billingRepository,
    get providerQuota() {
      return providerQuota;
    },
    set providerQuota(value: number) {
      providerQuota = value;
    },
  };
}

test("admin can query users, orders, mappings, and reconciliation records", async () => {
  const { service } = harness();
  const users = await service.listUsers(adminActor, { page: 1, pageSize: 20 });
  assert.equal(users.ok, true);
  if (!users.ok) return;
  assert.equal(users.total, 2);

  const orders = await service.listOrders(adminActor, { status: "review" });
  assert.equal(orders.ok, true);
  if (!orders.ok) return;
  assert.equal(orders.total, 1);

  const mappings = await service.listMappings(adminActor, { status: "active" });
  assert.equal(mappings.ok, true);
  if (!mappings.ok) return;
  assert.equal(mappings.total, 1);

  const tasks = await service.listTaskBillingRecords(adminActor, { state: "reconciliation_required" });
  assert.equal(tasks.ok, true);
  if (!tasks.ok) return;
  assert.equal(tasks.total, 1);
});

test("anonymous and normal users cannot access admin service", async () => {
  const anonymousHarness = harness();
  const anonymous = createAdminService({
    authRepository: anonymousHarness.authRepository,
    billingRepository: anonymousHarness.billingRepository,
    currentUser: async () => ({
      ok: false,
      status: 401,
      code: "AUTH_SESSION_EXPIRED",
      uiState: "session_expired",
      message: "Session is missing or expired.",
    }),
  });
  const anonymousResult = await anonymous.requireAdmin(null);
  assert.equal(anonymousResult.ok, false);
  if (!anonymousResult.ok) assert.equal(anonymousResult.status, 401);

  const normalHarness = harness();
  const normalUser = createAdminService({
    authRepository: normalHarness.authRepository,
    billingRepository: normalHarness.billingRepository,
    currentUser: async () => ({
      ok: true,
      status: 200,
      uiState: "success",
      user: {
        local_user_id: "target-user",
        email: "target@example.com",
        username: "target",
        display_name: "Target",
        status: "active",
        role: "user",
      },
      mappingStatus: "active",
      session: null,
      redirectTo: "/",
    }),
  });
  const denied = await normalUser.requireAdmin("user-session");
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.status, 403);
});

test("admin user status changes and order review write audit records", async () => {
  const { service, authRepository } = harness();
  const updated = await service.updateUserStatus(adminActor, "target-user", "disabled", "policy violation token:hidden");
  assert.equal(updated.ok, true);
  if (!updated.ok) return;
  assert.equal(updated.user.status, "disabled");

  const reviewed = await service.reviewOrder(adminActor, "bo_admin", "failed", "manual review password:hidden");
  assert.equal(reviewed.ok, true);
  if (!reviewed.ok) return;
  assert.equal(reviewed.order.status, "failed");

  const audit = await authRepository.listAuditEvents();
  assert.equal(audit.some((event) => event.event === "admin.users.status_updated"), true);
  assert.equal(audit.some((event) => event.event === "admin.billing.orders.reviewed"), true);
  assert.equal(JSON.stringify(audit).includes("token:hidden"), false);
  assert.equal(JSON.stringify(audit).includes("password:hidden"), false);
});

test("quota adjustment is idempotent and does not create a second local balance", async () => {
  const harnessed = harness();
  const first = await harnessed.service.adjustQuota(adminActor, {
    localUserId: "target-user",
    quotaDelta: 50,
    idempotencyKey: "quota-admin-1",
    reason: "support adjustment",
  });
  assert.equal(first.ok, true);
  assert.equal(harnessed.providerQuota, 1050);

  const duplicate = await harnessed.service.adjustQuota(adminActor, {
    localUserId: "target-user",
    quotaDelta: 50,
    idempotencyKey: "quota-admin-1",
    reason: "support adjustment retry",
  });
  assert.equal(duplicate.ok, true);
  assert.equal(harnessed.providerQuota, 1050);
});

test("unknown provider quota change blocks automatic overwrite", async () => {
  const harnessed = harness();
  const originalApplied = harnessed.service["taskRepository"].markQuotaAdjustmentApplied?.bind(harnessed.service["taskRepository"]);
  let failApplied = true;
  harnessed.service["taskRepository"].markQuotaAdjustmentApplied = async (
    idempotencyKey: string,
    providerAdjustmentId: string,
    markNow?: Date,
  ): Promise<TaskQuotaAdjustment> => {
    if (failApplied) {
      failApplied = false;
      throw new Error("simulated local marker failure database hidden");
    }
    return originalApplied!(idempotencyKey, providerAdjustmentId, markNow);
  };
  const first = await harnessed.service.adjustQuota(adminActor, {
    localUserId: "target-user",
    quotaDelta: 50,
    idempotencyKey: "quota-admin-unknown",
    reason: "support adjustment",
  });
  assert.equal(first.ok, false);
  assert.equal(harnessed.providerQuota, 1050);
  harnessed.providerQuota = 1040;

  const retry = await harnessed.service.adjustQuota(adminActor, {
    localUserId: "target-user",
    quotaDelta: 50,
    idempotencyKey: "quota-admin-unknown",
    reason: "support adjustment retry",
  });
  assert.equal(retry.ok, false);
  if (!retry.ok) assert.equal(retry.code, "admin_conflict");
  assert.equal(harnessed.providerQuota, 1040);
});

test("invalid admin operations are rejected without cross-user mutation", async () => {
  const { service } = harness();
  const invalidStatus = await service.updateUserStatus(adminActor, "target-user", "root", "bad status");
  assert.equal(invalidStatus.ok, false);
  if (!invalidStatus.ok) assert.equal(invalidStatus.status, 400);

  const invalidOrder = await service.reviewOrder(adminActor, "bo_admin", "paid", "unsafe transition");
  assert.equal(invalidOrder.ok, false);
  if (!invalidOrder.ok) assert.equal(invalidOrder.status, 409);
});
