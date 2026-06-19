import { randomUUID } from "node:crypto";

import {
  adminGetNewApiUser,
  adminSetNewApiUserQuota,
  type NewApiUserMapping,
  type NewApiUserMappingRepository,
  type NewApiUserMappingStatus,
} from "../integrations/new-api";
import {
  createAuthPersistenceRepositories,
  getAuthService,
  type AuthAuditEvent,
  type AuthResult,
  type AuthRepository,
  type AuthRequestContext,
  type AuthUser,
  type AuthUserStatus,
  type AuthUserRole,
} from "../auth";
import {
  createBillingPersistenceRepository,
  type BillingOrderStatus,
} from "../billing";
import { type BillingRepository } from "../billing/repository";
import {
  createTaskBillingPersistenceRepositories,
  type TaskBillingState,
} from "../quota";
import { type TaskBillingRepository, type TaskQuotaAdjustment } from "../quota/task-billing-repository";

export type AdminFailureCode =
  | "admin_auth_required"
  | "admin_permission_denied"
  | "admin_invalid_request"
  | "admin_not_found"
  | "admin_conflict"
  | "admin_upstream_unavailable";

export type AdminFailure = {
  ok: false;
  status: number;
  code: AdminFailureCode;
  message: string;
};

type AdminSuccess<T> = T & {
  ok: true;
  status: number;
};

export type AdminActor = {
  localUserId: string;
  role: "admin";
};

export type AdminServiceDependencies = {
  authRepository?: AuthRepository;
  mappingRepository?: NewApiUserMappingRepository;
  billingRepository?: BillingRepository;
  taskRepository?: TaskBillingRepository;
  currentUser?: (sessionToken?: string | null, context?: AuthRequestContext) => Promise<AuthResult>;
  getProviderQuota?: (newApiUserId: string) => Promise<number>;
  setProviderQuota?: (newApiUserId: string, quota: number) => Promise<void>;
  now?: () => Date;
};

const userStatuses = new Set<AuthUserStatus>(["active", "disabled", "verification_required"]);
const userRoles = new Set<AuthUserRole>(["user", "admin"]);
const mappingStatuses = new Set<NewApiUserMappingStatus>([
  "pending",
  "active",
  "failed",
  "disabled",
  "orphaned",
  "repair_required",
]);
const orderStatuses = new Set<BillingOrderStatus>([
  "pending",
  "processing",
  "paid",
  "failed",
  "cancelled",
  "review",
  "refunded",
]);
const taskStates = new Set<TaskBillingState>([
  "prechecked",
  "dispatching",
  "provider_started",
  "accepted",
  "settled",
  "failed",
  "cancelled",
  "reconciliation_required",
]);
const safeOrderReviewTransitions: Record<BillingOrderStatus, BillingOrderStatus[]> = {
  pending: ["review", "cancelled", "failed"],
  processing: ["review", "cancelled", "failed"],
  paid: ["review"],
  failed: ["review"],
  cancelled: ["review"],
  review: ["processing", "failed", "cancelled"],
  refunded: ["review"],
};
const financialSideEffectOrderStatuses = new Set<BillingOrderStatus>(["paid", "refunded"]);

function failure(code: AdminFailureCode, status: number, message: string): AdminFailure {
  return { ok: false, code, status, message };
}

function nowIso(now: Date) {
  return now.toISOString();
}

function page(value?: number) {
  return Math.max(1, Math.trunc(value || 1));
}

function pageSize(value?: number) {
  return Math.min(100, Math.max(1, Math.trunc(value || 20)));
}

function publicUser(user: AuthUser) {
  return {
    local_user_id: user.local_user_id,
    email: user.email,
    username: user.username,
    display_name: user.display_name,
    status: user.status,
    role: user.role,
    session_version: user.session_version,
    created_at: user.created_at,
    updated_at: user.updated_at,
    last_login_at: user.last_login_at,
  };
}

function sanitize(value: unknown) {
  return String(value || "")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/Authorization[=:]\s*[^,\s}]+/gi, "Authorization=[REDACTED]")
    .replace(/(token|password|cookie|secret|key|signature)[=:]\s*[^,\s}]+/gi, "$1=[REDACTED]")
    .replace(/postgres(?:ql)?:\/\/[^\s,}]+/gi, "postgresql://[REDACTED]")
    .replace(/redis:\/\/[^\s,}]+/gi, "redis://[REDACTED]")
    .slice(0, 300);
}

function extractQuota(payload: Awaited<ReturnType<typeof adminGetNewApiUser>>["data"]) {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as { quota?: unknown; data?: { quota?: unknown }; user?: { quota?: unknown } };
  const quota = Number(root.quota ?? root.data?.quota ?? root.user?.quota);
  return Number.isFinite(quota) ? quota : null;
}

function quotaAdjustmentRequestConflicts(
  adjustment: TaskQuotaAdjustment,
  input: { localUserId: string; quotaDelta: number },
  newApiUserId: string,
  taskId: string,
) {
  const conflicts: string[] = [];
  if (adjustment.local_user_id !== input.localUserId.trim()) conflicts.push("local_user_id");
  if (adjustment.new_api_user_id !== newApiUserId.trim()) conflicts.push("new_api_user_id");
  if (adjustment.task_id !== taskId.trim()) conflicts.push("task_id");
  if (adjustment.quota_delta !== input.quotaDelta) conflicts.push("quota_delta");
  return conflicts;
}

async function defaultGetProviderQuota(newApiUserId: string) {
  const response = await adminGetNewApiUser({ newApiUserId: Number(newApiUserId) });
  const quota = extractQuota(response.data);
  if (quota === null) throw new Error("New API quota read failed.");
  return quota;
}

async function defaultSetProviderQuota(newApiUserId: string, quota: number) {
  await adminSetNewApiUserQuota({ newApiUserId: Number(newApiUserId), quota });
}

export class AdminService {
  private readonly authRepository: AuthRepository;
  private readonly mappingRepository: NewApiUserMappingRepository;
  private readonly billingRepository: BillingRepository;
  private readonly taskRepository: TaskBillingRepository;
  private readonly currentUser: (sessionToken?: string | null, context?: AuthRequestContext) => Promise<AuthResult>;
  private readonly getProviderQuota: (newApiUserId: string) => Promise<number>;
  private readonly setProviderQuota: (newApiUserId: string, quota: number) => Promise<void>;
  private readonly now: () => Date;

  constructor(dependencies: AdminServiceDependencies = {}) {
    let authRepository = dependencies.authRepository;
    let mappingRepository = dependencies.mappingRepository;
    if (!authRepository || !mappingRepository) {
      const authPersistence = createAuthPersistenceRepositories();
      authRepository = authRepository || authPersistence.authRepository;
      mappingRepository = mappingRepository || authPersistence.mappingRepository;
    }
    this.authRepository = authRepository;
    this.mappingRepository = mappingRepository;
    this.billingRepository = dependencies.billingRepository || createBillingPersistenceRepository();
    this.taskRepository = dependencies.taskRepository || createTaskBillingPersistenceRepositories().taskRepository;
    this.currentUser = dependencies.currentUser || ((sessionToken, context) => getAuthService().currentUser(sessionToken, context));
    this.getProviderQuota = dependencies.getProviderQuota || defaultGetProviderQuota;
    this.setProviderQuota = dependencies.setProviderQuota || defaultSetProviderQuota;
    this.now = dependencies.now || (() => new Date());
  }

  async requireAdmin(sessionToken?: string | null, context: AuthRequestContext = {}) {
    const auth = await this.currentUser(sessionToken, context);
    if (!auth.ok) return failure("admin_auth_required", 401, "Admin authentication is required.");
    if (auth.user.role !== "admin") {
      await this.audit("admin.permission_denied", auth.user.local_user_id, context, { role: auth.user.role });
      return failure("admin_permission_denied", 403, "Admin permission is required.");
    }
    return {
      ok: true as const,
      status: 200,
      actor: {
        localUserId: auth.user.local_user_id,
        role: "admin" as const,
      },
    };
  }

  async listUsers(actor: AdminActor, input: { status?: string; role?: string; query?: string; page?: number; pageSize?: number }, context: AuthRequestContext = {}) {
    if (input.status && !userStatuses.has(input.status as AuthUserStatus)) return failure("admin_invalid_request", 400, "User status is invalid.");
    if (input.role && !userRoles.has(input.role as AuthUserRole)) return failure("admin_invalid_request", 400, "User role is invalid.");
    const currentPage = page(input.page);
    const currentPageSize = pageSize(input.pageSize);
    const result = await this.authRepository.listUsersPage({
      status: input.status as AuthUserStatus | undefined,
      role: input.role as AuthUserRole | undefined,
      query: input.query,
      page: currentPage,
      pageSize: currentPageSize,
    });
    await this.audit("admin.users.list", actor.localUserId, context, { page: currentPage, page_size: currentPageSize });
    return {
      ok: true as const,
      status: 200,
      users: result.users.map(publicUser),
      page: currentPage,
      page_size: currentPageSize,
      total: result.total,
      has_more: currentPage * currentPageSize < result.total,
    };
  }

  async getUser(actor: AdminActor, localUserId: string, context: AuthRequestContext = {}) {
    const user = await this.authRepository.getUserById(localUserId);
    if (!user) return failure("admin_not_found", 404, "User was not found.");
    const mapping = await this.mappingRepository.getByLocalUserId(localUserId);
    await this.audit("admin.users.get", actor.localUserId, context, { target_user_id: localUserId });
    return {
      ok: true as const,
      status: 200,
      user: publicUser(user),
      mapping,
    };
  }

  async updateUserStatus(actor: AdminActor, localUserId: string, status: string, reason: string, context: AuthRequestContext = {}) {
    if (!userStatuses.has(status as AuthUserStatus)) return failure("admin_invalid_request", 400, "User status is invalid.");
    if (!reason.trim()) return failure("admin_invalid_request", 400, "Reason is required.");
    const current = await this.authRepository.getUserById(localUserId);
    if (!current) return failure("admin_not_found", 404, "User was not found.");
    const updated = current.status === status
      ? current
      : await this.authRepository.updateUser(localUserId, { status: status as AuthUserStatus }, this.now());
    await this.audit("admin.users.status_updated", actor.localUserId, context, {
      target_user_id: localUserId,
      previous_status: current.status,
      status,
      reason: sanitize(reason),
    });
    return { ok: true as const, status: 200, user: publicUser(updated) };
  }

  async listMappings(actor: AdminActor, input: { status?: string; localUserId?: string; page?: number; pageSize?: number }, context: AuthRequestContext = {}) {
    if (input.status && !mappingStatuses.has(input.status as NewApiUserMappingStatus)) {
      return failure("admin_invalid_request", 400, "Mapping status is invalid.");
    }
    const currentPage = page(input.page);
    const currentPageSize = pageSize(input.pageSize);
    const result = this.mappingRepository.listMappingsPage
      ? await this.mappingRepository.listMappingsPage({
        status: input.status as NewApiUserMappingStatus | undefined,
        localUserId: input.localUserId,
        page: currentPage,
        pageSize: currentPageSize,
      })
      : await this.listMappingsFallback(input.status as NewApiUserMappingStatus | undefined, currentPage, currentPageSize);
    await this.audit("admin.mappings.list", actor.localUserId, context, { page: currentPage, page_size: currentPageSize });
    return {
      ok: true as const,
      status: 200,
      mappings: result.mappings,
      page: currentPage,
      page_size: currentPageSize,
      total: result.total,
      has_more: currentPage * currentPageSize < result.total,
    };
  }

  async repairMapping(actor: AdminActor, localUserId: string, action: string, reason: string, context: AuthRequestContext = {}) {
    if (!reason.trim()) return failure("admin_invalid_request", 400, "Reason is required.");
    let mapping: NewApiUserMapping;
    if (action === "retry") {
      mapping = await this.mappingRepository.prepareRetry({ localUserId, allowRepairRequired: true, now: this.now() });
    } else if (action === "repair_required") {
      mapping = await this.mappingRepository.scheduleRepair({ localUserId, code: "ADMIN_REPAIR_REQUIRED", message: reason, now: this.now() });
    } else if (action === "disabled") {
      mapping = await this.mappingRepository.markDisabled({ localUserId, code: "ADMIN_DISABLED", message: reason, now: this.now() });
    } else if (action === "orphaned") {
      mapping = await this.mappingRepository.markOrphaned({ localUserId, code: "ADMIN_ORPHANED", message: reason, now: this.now() });
    } else {
      return failure("admin_invalid_request", 400, "Mapping repair action is invalid.");
    }
    await this.audit("admin.mappings.repaired", actor.localUserId, context, {
      target_user_id: localUserId,
      action,
      reason: sanitize(reason),
    });
    return { ok: true as const, status: 200, mapping };
  }

  async adjustQuota(actor: AdminActor, input: { localUserId: string; quotaDelta: number; idempotencyKey: string; reason: string }, context: AuthRequestContext = {}) {
    if (!Number.isInteger(input.quotaDelta) || input.quotaDelta === 0) return failure("admin_invalid_request", 400, "Quota delta is invalid.");
    if (!input.idempotencyKey.trim() || !input.reason.trim()) return failure("admin_invalid_request", 400, "Idempotency key and reason are required.");
    const mapping = await this.mappingRepository.getByLocalUserId(input.localUserId);
    if (!mapping || mapping.sync_status !== "active" || !mapping.new_api_user_id) {
      return failure("admin_conflict", 409, "Active New API mapping is required.");
    }
    if (!this.taskRepository.claimQuotaAdjustment || !this.taskRepository.markQuotaAdjustmentApplied || !this.taskRepository.markQuotaAdjustmentFailed) {
      return failure("admin_conflict", 409, "Quota adjustment repository is not configured.");
    }
    const operation = async (): Promise<AdminSuccess<{ adjustment: unknown; original_quota: number; target_quota: number }> | AdminFailure> => {
      try {
        const currentQuota = await this.getProviderQuota(mapping.new_api_user_id!);
        const originalQuota = currentQuota;
        const targetQuota = originalQuota + input.quotaDelta;
        const newApiUserId = mapping.new_api_user_id!;
        const taskId = `admin:${input.idempotencyKey.trim()}`;
        const adjustment = await this.taskRepository.claimQuotaAdjustment!({
          localUserId: input.localUserId,
          newApiUserId,
          taskId,
          idempotencyKey: `admin-quota:${input.idempotencyKey.trim()}`,
          quotaDelta: input.quotaDelta,
          originalQuota,
          targetQuota,
          now: this.now(),
        });
        const conflictFields = quotaAdjustmentRequestConflicts(adjustment, input, newApiUserId, taskId);
        if (conflictFields.length) {
          await this.audit("admin.quota.adjustment_idempotency_conflict", actor.localUserId, context, {
            target_user_id: input.localUserId,
            idempotency_key: input.idempotencyKey.trim(),
            conflict_fields: conflictFields.join(","),
            reason: sanitize(input.reason),
          });
          return failure("admin_conflict", 409, "Idempotency key is already used for a different quota adjustment.");
        }
        if (adjustment.status === "applied") {
          await this.audit("admin.quota.adjustment_idempotent", actor.localUserId, context, {
            target_user_id: input.localUserId,
            idempotency_key: input.idempotencyKey.trim(),
          });
          return { ok: true, status: 200, adjustment, original_quota: adjustment.original_quota ?? originalQuota, target_quota: adjustment.target_quota ?? targetQuota };
        }
        const persistedOriginalQuota = adjustment.original_quota ?? originalQuota;
        const persistedTargetQuota = adjustment.target_quota ?? targetQuota;
        if (!adjustment.created && currentQuota === persistedTargetQuota) {
          const applied = await this.taskRepository.markQuotaAdjustmentApplied!(
            `admin-quota:${input.idempotencyKey.trim()}`,
            `new-api:admin:${input.idempotencyKey.trim()}:recovered`,
            this.now(),
          );
          await this.audit("admin.quota.adjustment_recovered", actor.localUserId, context, {
            target_user_id: input.localUserId,
            idempotency_key: input.idempotencyKey.trim(),
          });
          return { ok: true, status: 200, adjustment: applied, original_quota: persistedOriginalQuota, target_quota: persistedTargetQuota };
        }
        if (!adjustment.created && currentQuota !== persistedOriginalQuota) {
          const error = "New API quota changed outside the pending admin adjustment.";
          await this.taskRepository.markQuotaAdjustmentFailed!(`admin-quota:${input.idempotencyKey.trim()}`, error, this.now()).catch(() => undefined);
          await this.audit("admin.quota.adjustment_reconciliation_required", actor.localUserId, context, {
            target_user_id: input.localUserId,
            idempotency_key: input.idempotencyKey.trim(),
          });
          return failure("admin_conflict", 409, "Quota changed and requires manual reconciliation.");
        }
        await this.setProviderQuota(mapping.new_api_user_id!, persistedTargetQuota);
        const applied = await this.taskRepository.markQuotaAdjustmentApplied!(
          `admin-quota:${input.idempotencyKey.trim()}`,
          `new-api:admin:${input.idempotencyKey.trim()}`,
          this.now(),
        );
        await this.audit("admin.quota.adjusted", actor.localUserId, context, {
          target_user_id: input.localUserId,
          quota_delta: input.quotaDelta,
          original_quota: persistedOriginalQuota,
          target_quota: persistedTargetQuota,
          reason: sanitize(input.reason),
          idempotency_key: input.idempotencyKey.trim(),
        });
        return { ok: true, status: 200, adjustment: applied, original_quota: persistedOriginalQuota, target_quota: persistedTargetQuota };
      } catch (error) {
        await this.audit("admin.quota.adjustment_failed", actor.localUserId, context, {
          target_user_id: input.localUserId,
          error: sanitize(error instanceof Error ? error.message : "quota adjustment failed"),
        });
        return failure("admin_upstream_unavailable", 503, "Quota adjustment is unavailable.");
      }
    };
    if (this.taskRepository.withQuotaAdjustmentLock) {
      return this.taskRepository.withQuotaAdjustmentLock(mapping.new_api_user_id, operation);
    }
    return operation();
  }

  async listOrders(actor: AdminActor, input: { localUserId?: string; status?: string; page?: number; pageSize?: number }, context: AuthRequestContext = {}) {
    if (input.status && !orderStatuses.has(input.status as BillingOrderStatus)) return failure("admin_invalid_request", 400, "Order status is invalid.");
    const currentPage = page(input.page);
    const currentPageSize = pageSize(input.pageSize);
    const result = this.billingRepository.listOrdersPage
      ? await this.billingRepository.listOrdersPage({
        localUserId: input.localUserId,
        statuses: input.status ? [input.status as BillingOrderStatus] : undefined,
        page: currentPage,
        pageSize: currentPageSize,
      })
      : await this.billingOrdersFallback(input.localUserId, input.status as BillingOrderStatus | undefined, currentPage, currentPageSize);
    await this.audit("admin.billing.orders.list", actor.localUserId, context, { page: currentPage, page_size: currentPageSize });
    return {
      ok: true as const,
      status: 200,
      orders: result.orders,
      page: currentPage,
      page_size: currentPageSize,
      total: result.total,
      has_more: currentPage * currentPageSize < result.total,
    };
  }

  async getOrder(actor: AdminActor, orderId: string, context: AuthRequestContext = {}) {
    const order = await this.billingRepository.getOrder(orderId);
    if (!order) return failure("admin_not_found", 404, "Order was not found.");
    await this.audit("admin.billing.orders.get", actor.localUserId, context, { order_id: orderId });
    return { ok: true as const, status: 200, order };
  }

  async reviewOrder(actor: AdminActor, orderId: string, targetStatus: string, reason: string, context: AuthRequestContext = {}) {
    if (!orderStatuses.has(targetStatus as BillingOrderStatus)) return failure("admin_invalid_request", 400, "Order status is invalid.");
    if (!reason.trim()) return failure("admin_invalid_request", 400, "Reason is required.");
    const order = await this.billingRepository.getOrder(orderId);
    if (!order) return failure("admin_not_found", 404, "Order was not found.");
    const nextStatus = targetStatus as BillingOrderStatus;
    if (financialSideEffectOrderStatuses.has(nextStatus)) {
      await this.billingRepository.appendAudit({
        event: "admin.billing.orders.review_blocked",
        order_id: order.order_id,
        local_user_id: actor.localUserId,
        safe_details: {
          target_order_id: order.order_id,
          previous_status: order.status,
          requested_status: nextStatus,
          block_reason: "financial_side_effect_required",
          reason: sanitize(reason),
        },
      });
      await this.audit("admin.billing.orders.review_blocked", actor.localUserId, context, {
        order_id: order.order_id,
        status: nextStatus,
        block_reason: "financial_side_effect_required",
        reason: sanitize(reason),
      });
      return failure("admin_conflict", 409, "Order transition requires a dedicated financial workflow.");
    }
    const allowedNext = safeOrderReviewTransitions[order.status as BillingOrderStatus] || [];
    if (order.status !== nextStatus && !allowedNext.includes(nextStatus)) {
      return failure("admin_conflict", 409, "Order transition is not allowed.");
    }
    const updated = order.status === nextStatus
      ? order
      : await this.billingRepository.updateOrder(order.order_id, {
        status: nextStatus,
        updated_at: nowIso(this.now()),
        last_error: sanitize(reason),
      }, order.version);
    await this.billingRepository.appendAudit({
      event: "admin.billing.orders.reviewed",
      order_id: order.order_id,
      local_user_id: actor.localUserId,
      safe_details: {
        target_order_id: order.order_id,
        previous_status: order.status,
        status: nextStatus,
        reason: sanitize(reason),
      },
    });
    await this.audit("admin.billing.orders.reviewed", actor.localUserId, context, { order_id: order.order_id, status: nextStatus });
    return { ok: true as const, status: 200, order: updated };
  }

  async listTaskBillingRecords(actor: AdminActor, input: { localUserId?: string; state?: string; taskId?: string; page?: number; pageSize?: number }, context: AuthRequestContext = {}) {
    if (input.state && !taskStates.has(input.state as TaskBillingState)) return failure("admin_invalid_request", 400, "Task billing state is invalid.");
    const currentPage = page(input.page);
    const currentPageSize = pageSize(input.pageSize);
    const result = this.taskRepository.listRecordsPage
      ? await this.taskRepository.listRecordsPage({
        localUserId: input.localUserId,
        states: input.state ? [input.state as TaskBillingState] : undefined,
        taskId: input.taskId,
        page: currentPage,
        pageSize: currentPageSize,
      })
      : { records: [], total: 0 };
    await this.audit("admin.task_billing.records.list", actor.localUserId, context, { page: currentPage, page_size: currentPageSize });
    return {
      ok: true as const,
      status: 200,
      records: result.records,
      page: currentPage,
      page_size: currentPageSize,
      total: result.total,
      has_more: currentPage * currentPageSize < result.total,
    };
  }

  private async listMappingsFallback(status: NewApiUserMappingStatus | undefined, currentPage: number, currentPageSize: number) {
    if (!status) return { mappings: [], total: 0 };
    const mappings = await this.mappingRepository.listByStatus(status);
    const start = (currentPage - 1) * currentPageSize;
    return { mappings: mappings.slice(start, start + currentPageSize), total: mappings.length };
  }

  private async billingOrdersFallback(localUserId: string | undefined, status: BillingOrderStatus | undefined, currentPage: number, currentPageSize: number) {
    const orders = await this.billingRepository.listOrders({
      localUserId,
      statuses: status ? [status] : undefined,
    });
    const start = (currentPage - 1) * currentPageSize;
    return { orders: orders.slice(start, start + currentPageSize), total: orders.length };
  }

  private async audit(
    event: string,
    actorLocalUserId: string | null,
    context: AuthRequestContext,
    details: Record<string, string | number | boolean | null>,
  ) {
    const auditEvent: AuthAuditEvent = {
      id: randomUUID(),
      event,
      local_user_id: actorLocalUserId,
      created_at: nowIso(this.now()),
      request_id: context.requestId || null,
      ip_hash: null,
      user_agent_hash: null,
      details,
    };
    await this.authRepository.appendAudit(auditEvent);
  }
}

let defaultAdminService: AdminService | null = null;

export function createAdminService(dependencies?: AdminServiceDependencies) {
  return new AdminService(dependencies);
}

export function getAdminService() {
  defaultAdminService ||= new AdminService();
  return defaultAdminService;
}
