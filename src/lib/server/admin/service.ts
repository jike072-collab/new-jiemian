import { randomUUID } from "node:crypto";

import {
  adminGetNewApiUser,
  adminSetNewApiUserQuota,
  creditsToNewApiQuota,
  createNewApiUserSyncService,
  getNewApiQuotaDisplayConfig,
  newApiQuotaToCredits,
  type NewApiQuotaDisplayConfig,
  type NewApiUserMapping,
  type NewApiUserMappingRepository,
  type NewApiUserMappingStatus,
  type NewApiUserSyncService,
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
  getQuotaService,
  type TaskBillingState,
} from "../quota";
import { type TaskBillingRepository, type TaskQuotaAdjustment } from "../quota/task-billing-repository";
import { getMembershipService, type MembershipService } from "../membership/service";

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
  membershipService?: MembershipService;
  userSyncService?: NewApiUserSyncService;
  currentUser?: (sessionToken?: string | null, context?: AuthRequestContext) => Promise<AuthResult>;
  getQuotaDisplayConfig?: () => Promise<NewApiQuotaDisplayConfig>;
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
  "expired",
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
  expired: ["review"],
  review: ["processing", "failed", "cancelled"],
  refunded: ["review"],
};
const financialSideEffectOrderStatuses = new Set<BillingOrderStatus>(["paid", "refunded"]);

function failure(code: AdminFailureCode, status: number, message: string): AdminFailure {
  return { ok: false, code, status, message };
}

function shouldReleaseDisabledUserIdentity(status: string, reason: string, releaseIdentity?: boolean) {
  if (status !== "disabled") return false;
  if (releaseIdentity === true) return true;
  const normalized = reason.trim().toLowerCase();
  return /注销|释放邮箱|释放账号|释放登录|delete account|deleted account|release identity|release email/.test(normalized);
}

function nowIso(now: Date) {
  return now.toISOString();
}

function createGrantBillingOrderId() {
  return `bo_${randomUUID().replace(/-/g, "").slice(0, 29)}`;
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

async function defaultGetProviderQuota(
  newApiUserId: string,
  getQuotaDisplayConfig: () => Promise<NewApiQuotaDisplayConfig>,
) {
  const response = await adminGetNewApiUser({ newApiUserId: Number(newApiUserId) });
  const quota = extractQuota(response.data);
  if (quota === null) throw new Error("New API quota read failed.");
  return newApiQuotaToCredits(quota, await getQuotaDisplayConfig());
}

async function defaultSetProviderQuota(
  newApiUserId: string,
  quota: number,
  getQuotaDisplayConfig: () => Promise<NewApiQuotaDisplayConfig>,
) {
  await adminSetNewApiUserQuota({
    newApiUserId: Number(newApiUserId),
    quota: creditsToNewApiQuota(quota, await getQuotaDisplayConfig()),
  });
}

export class AdminService {
  private readonly authRepository: AuthRepository;
  private readonly mappingRepository: NewApiUserMappingRepository;
  private readonly billingRepository: BillingRepository;
  private readonly taskRepository: TaskBillingRepository;
  private readonly membershipService: MembershipService;
  private readonly userSyncService: NewApiUserSyncService;
  private readonly currentUser: (sessionToken?: string | null, context?: AuthRequestContext) => Promise<AuthResult>;
  private readonly getQuotaDisplayConfig: NonNullable<AdminServiceDependencies["getQuotaDisplayConfig"]>;
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
    this.membershipService = dependencies.membershipService || getMembershipService();
    this.userSyncService = dependencies.userSyncService || createNewApiUserSyncService({ repository: this.mappingRepository });
    this.currentUser = dependencies.currentUser || ((sessionToken, context) => getAuthService().currentUser(sessionToken, context));
    this.getQuotaDisplayConfig = dependencies.getQuotaDisplayConfig || getNewApiQuotaDisplayConfig;
    this.getProviderQuota = dependencies.getProviderQuota || ((newApiUserId) => defaultGetProviderQuota(newApiUserId, this.getQuotaDisplayConfig));
    this.setProviderQuota = dependencies.setProviderQuota || ((newApiUserId, quota) => defaultSetProviderQuota(newApiUserId, quota, this.getQuotaDisplayConfig));
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

  private async publicUserWithMembership(user: AuthUser) {
    return {
      ...publicUser(user),
      membership: await this.membershipService.getStatus(user.local_user_id),
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
    const users = await Promise.all(result.users.map((user) => this.publicUserWithMembership(user)));
    await this.audit("admin.users.list", actor.localUserId, context, { page: currentPage, page_size: currentPageSize });
    return {
      ok: true as const,
      status: 200,
      users,
      membership_plans: this.membershipService.listPlans(),
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
    let quotaUnits: number | null = null;
    if (mapping?.sync_status === "active" && mapping.new_api_user_id) {
      quotaUnits = await this.getProviderQuota(mapping.new_api_user_id).catch(() => null);
    }
    await this.audit("admin.users.get", actor.localUserId, context, { target_user_id: localUserId });
    return {
      ok: true as const,
      status: 200,
      user: await this.publicUserWithMembership(user),
      mapping,
      quota_units: quotaUnits,
      membership_plans: this.membershipService.listPlans(),
    };
  }

  private async isOnlyActiveAdmin(user: AuthUser) {
    if (user.role !== "admin" || user.status !== "active") return false;
    const admins = await this.authRepository.listUsersPage({
      role: "admin",
      status: "active",
      page: 1,
      pageSize: 2,
    });
    return admins.total <= 1;
  }

  async updateUserStatus(
    actor: AdminActor,
    localUserId: string,
    status: string,
    reason: string,
    context: AuthRequestContext = {},
    options: { releaseIdentity?: boolean } = {},
  ) {
    if (!userStatuses.has(status as AuthUserStatus)) return failure("admin_invalid_request", 400, "User status is invalid.");
    if (!reason.trim()) return failure("admin_invalid_request", 400, "Reason is required.");
    const current = await this.authRepository.getUserById(localUserId);
    if (!current) return failure("admin_not_found", 404, "User was not found.");
    const releaseIdentity = shouldReleaseDisabledUserIdentity(status, reason, options.releaseIdentity);
    if (status === "disabled" && await this.isOnlyActiveAdmin(current)) {
      return failure("admin_conflict", 409, "The only active administrator cannot be disabled.");
    }
    let updated = current.status === status
      ? current
      : await this.authRepository.updateUser(localUserId, { status: status as AuthUserStatus }, this.now());
    if (releaseIdentity) {
      updated = await this.authRepository.releaseUserIdentity(localUserId, this.now());
    }
    await this.audit("admin.users.status_updated", actor.localUserId, context, {
      target_user_id: localUserId,
      previous_status: current.status,
      status,
      identity_released: releaseIdentity,
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

  private async ensureQuotaMapping(localUserId: string, idempotencyKey: string, context: AuthRequestContext) {
    const user = await this.authRepository.getUserById(localUserId);
    if (!user) return failure("admin_not_found", 404, "User was not found.");
    try {
      const sync = await this.userSyncService.ensureMapped({
        localUserId: user.local_user_id,
        email: user.email,
        username: user.username,
        displayName: user.display_name,
        initialQuota: 0,
      }, {
        idempotencyKey: `admin-quota:${idempotencyKey}`,
      });
      if (sync.mapping.sync_status === "active" && sync.mapping.new_api_user_id) {
        await this.audit("admin.quota.mapping_ensured", user.local_user_id, context, {
          sync_action: sync.action,
        });
        return { ok: true as const, mapping: sync.mapping };
      }
      return failure("admin_conflict", 409, "Active New API mapping is required.");
    } catch (error) {
      await this.audit("admin.quota.mapping_failed", localUserId, context, {
        error: sanitize(error instanceof Error ? error.message : "mapping sync failed"),
      });
      return failure("admin_upstream_unavailable", 503, "New API user mapping is unavailable.");
    }
  }

  private async recordAdminGrantOrder(input: {
    localUserId: string;
    newApiUserId: string;
    creditedQuota: number;
    idempotencyKey: string;
  }) {
    if (input.creditedQuota <= 0) return;
    const existing = await this.billingRepository.getOrderByIdempotencyKey(input.localUserId, input.idempotencyKey);
    if (existing) return;
    const timestamp = nowIso(this.now());
    await this.billingRepository.createOrder({
      order_id: createGrantBillingOrderId(),
      local_user_id: input.localUserId,
      new_api_user_id: input.newApiUserId,
      channel: "admin_grant",
      currency: "CNY",
      requested_amount: 0,
      paid_amount: 0,
      credited_quota: input.creditedQuota,
      product_type: "credits",
      product_plan_id: null,
      product_cycle: null,
      status: "paid",
      idempotency_key: input.idempotencyKey,
      provider_order_id: `admin-grant:${input.localUserId}:${input.idempotencyKey}`,
      created_at: timestamp,
      updated_at: timestamp,
      paid_at: timestamp,
      last_error: null,
      quota_credit_applied_at: timestamp,
      refunded_at: null,
    });
  }

  async adjustQuota(actor: AdminActor, input: { localUserId: string; quotaDelta: number; idempotencyKey: string; reason: string }, context: AuthRequestContext = {}) {
    if (!Number.isInteger(input.quotaDelta) || input.quotaDelta === 0) return failure("admin_invalid_request", 400, "Quota delta is invalid.");
    if (!input.idempotencyKey.trim() || !input.reason.trim()) return failure("admin_invalid_request", 400, "Idempotency key and reason are required.");
    let mapping = await this.mappingRepository.getByLocalUserId(input.localUserId);
    if (!mapping || mapping.sync_status !== "active" || !mapping.new_api_user_id) {
      const ensured = await this.ensureQuotaMapping(input.localUserId, input.idempotencyKey.trim(), context);
      if (!ensured.ok) return ensured;
      mapping = ensured.mapping;
    }
    const activeNewApiUserId = mapping.new_api_user_id;
    if (!activeNewApiUserId) return failure("admin_conflict", 409, "Active New API mapping is required.");
    if (!this.taskRepository.claimQuotaAdjustment || !this.taskRepository.markQuotaAdjustmentApplied || !this.taskRepository.markQuotaAdjustmentFailed) {
      return failure("admin_conflict", 409, "Quota adjustment repository is not configured.");
    }
    const operation = async (): Promise<AdminSuccess<{ adjustment: unknown; original_quota: number; target_quota: number }> | AdminFailure> => {
      try {
        const currentQuota = await this.getProviderQuota(activeNewApiUserId);
        const originalQuota = currentQuota;
        const targetQuota = originalQuota + input.quotaDelta;
        const newApiUserId = activeNewApiUserId;
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
          await this.recordAdminGrantOrder({
            localUserId: input.localUserId,
            newApiUserId,
            creditedQuota: input.quotaDelta,
            idempotencyKey: `admin-grant:${input.idempotencyKey.trim()}`,
          });
          await this.audit("admin.quota.adjustment_idempotent", actor.localUserId, context, {
            target_user_id: input.localUserId,
            idempotency_key: input.idempotencyKey.trim(),
          });
          getQuotaService().invalidateCache(input.localUserId);
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
          await this.recordAdminGrantOrder({
            localUserId: input.localUserId,
            newApiUserId,
            creditedQuota: input.quotaDelta,
            idempotencyKey: `admin-grant:${input.idempotencyKey.trim()}`,
          });
          await this.audit("admin.quota.adjustment_recovered", actor.localUserId, context, {
            target_user_id: input.localUserId,
            idempotency_key: input.idempotencyKey.trim(),
          });
          getQuotaService().invalidateCache(input.localUserId);
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
        await this.recordAdminGrantOrder({
          localUserId: input.localUserId,
          newApiUserId,
          creditedQuota: input.quotaDelta,
          idempotencyKey: `admin-grant:${input.idempotencyKey.trim()}`,
        });
        getQuotaService().invalidateCache(input.localUserId);
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
      return this.taskRepository.withQuotaAdjustmentLock(activeNewApiUserId, operation);
    }
    return operation();
  }

  async reconcileExternalQuotaGrant(
    actor: AdminActor,
    input: { localUserId: string; originalQuota: number; quotaDelta: number; grantedAt: string; reference: string; reason: string },
    context: AuthRequestContext = {},
  ) {
    if (!Number.isInteger(input.originalQuota) || input.originalQuota < 0) {
      return failure("admin_invalid_request", 400, "Original quota is invalid.");
    }
    if (!Number.isInteger(input.quotaDelta) || input.quotaDelta <= 0) {
      return failure("admin_invalid_request", 400, "Quota delta must be a positive integer.");
    }
    const reference = input.reference.trim();
    const grantedAt = new Date(input.grantedAt);
    if (!/^[A-Za-z0-9:_-]{8,120}$/.test(reference) || Number.isNaN(grantedAt.getTime()) || !input.reason.trim()) {
      return failure("admin_invalid_request", 400, "Grant timestamp, reference, and reason are required.");
    }
    const mapping = await this.mappingRepository.getByLocalUserId(input.localUserId);
    if (!mapping || mapping.sync_status !== "active" || !mapping.new_api_user_id) {
      return failure("admin_conflict", 409, "Active New API mapping is required.");
    }
    const operation = async () => {
      try {
        const currentQuota = await this.getProviderQuota(mapping.new_api_user_id!);
        if (!this.taskRepository.listRecordsPage) {
          return failure("admin_conflict", 409, "Task billing history is required for reconciliation.");
        }
        const taskPage = await this.taskRepository.listRecordsPage({
          localUserId: input.localUserId,
          page: 1,
          pageSize: 100,
        });
        if (taskPage.total > taskPage.records.length) {
          return failure("admin_conflict", 409, "Task billing history exceeds the reconciliation limit.");
        }
        const subsequentTasks = taskPage.records.filter((record) => new Date(record.created_at).getTime() >= grantedAt.getTime());
        const nonterminalTask = subsequentTasks.find((record) => !["settled", "failed", "cancelled"].includes(record.billing_state));
        if (nonterminalTask) {
          return failure("admin_conflict", 409, "A subsequent task has not reached a reconcilable state.");
        }
        const subsequentSpentQuota = subsequentTasks.reduce((total, record) => (
          record.billing_state === "settled" && record.membership_entitlement_units === 0
            ? total + (record.final_quota_units || 0)
            : total
        ), 0);
        const expectedQuota = input.originalQuota + input.quotaDelta - subsequentSpentQuota;
        if (currentQuota !== expectedQuota) {
          await this.audit("admin.quota.external_grant_mismatch", actor.localUserId, context, {
            target_user_id: input.localUserId,
            original_quota: input.originalQuota,
            quota_delta: input.quotaDelta,
            expected_quota: expectedQuota,
            current_quota: currentQuota,
            granted_at: grantedAt.toISOString(),
            subsequent_spent_quota: subsequentSpentQuota,
            reference,
          });
          return failure("admin_conflict", 409, "Current quota does not match the external grant.");
        }
        const idempotencyKey = `admin-external-grant:${reference}`;
        await this.recordAdminGrantOrder({
          localUserId: input.localUserId,
          newApiUserId: mapping.new_api_user_id!,
          creditedQuota: input.quotaDelta,
          idempotencyKey,
        });
        await this.audit("admin.quota.external_grant_reconciled", actor.localUserId, context, {
          target_user_id: input.localUserId,
          original_quota: input.originalQuota,
          quota_delta: input.quotaDelta,
          target_quota: expectedQuota,
          granted_at: grantedAt.toISOString(),
          subsequent_spent_quota: subsequentSpentQuota,
          reference,
          reason: sanitize(input.reason),
        });
        getQuotaService().invalidateCache(input.localUserId);
        return {
          ok: true as const,
          status: 200,
          original_quota: input.originalQuota,
          target_quota: expectedQuota,
          credited_quota: input.quotaDelta,
          subsequent_spent_quota: subsequentSpentQuota,
        };
      } catch (error) {
        await this.audit("admin.quota.external_grant_failed", actor.localUserId, context, {
          target_user_id: input.localUserId,
          error: sanitize(error instanceof Error ? error.message : "external grant reconciliation failed"),
        });
        return failure("admin_upstream_unavailable", 503, "External quota reconciliation is unavailable.");
      }
    };
    if (this.taskRepository.withQuotaAdjustmentLock) {
      return this.taskRepository.withQuotaAdjustmentLock(mapping.new_api_user_id, operation);
    }
    return operation();
  }

  async grantMembership(actor: AdminActor, input: { localUserId: string; planId: string; cycle: string; idempotencyKey: string; reason: string }, context: AuthRequestContext = {}) {
    if (!input.idempotencyKey.trim() || !input.reason.trim()) return failure("admin_invalid_request", 400, "Idempotency key and reason are required.");
    const target = await this.authRepository.getUserById(input.localUserId);
    if (!target) return failure("admin_not_found", 404, "User was not found.");
    const sku = this.membershipService.getSku(input.planId, input.cycle);
    if (!sku) return failure("admin_invalid_request", 400, "Membership plan is invalid.");
    const idempotencyKey = `membership:${input.idempotencyKey.trim()}`;
    const quota = await this.adjustQuota(actor, {
      localUserId: input.localUserId,
      quotaDelta: sku.grant_credits,
      idempotencyKey,
      reason: `membership:${input.reason}`,
    }, context);
    if (!quota.ok) return quota;
    try {
      const orderId = this.membershipService.createManualOrderId(input.localUserId, idempotencyKey);
      const membership = await this.membershipService.applyManualMembership({
        localUserId: input.localUserId,
        orderId,
        planId: input.planId,
        cycle: input.cycle,
        now: this.now(),
      });
      getQuotaService().invalidateCache(input.localUserId);
      const status = await this.membershipService.getStatus(input.localUserId);
      await this.audit("admin.membership.granted", actor.localUserId, context, {
        target_user_id: input.localUserId,
        plan_id: sku.plan.id,
        cycle: sku.cycle,
        credited_quota: sku.grant_credits,
        reason: sanitize(input.reason),
      });
      return {
        ok: true as const,
        status: 200,
        membership,
        membership_status: status,
        credited_quota: sku.grant_credits,
      };
    } catch (error) {
      await this.audit("admin.membership.grant_failed", actor.localUserId, context, {
        target_user_id: input.localUserId,
        error: sanitize(error instanceof Error ? error.message : "membership grant failed"),
      });
      return failure("admin_upstream_unavailable", 503, "Membership grant is unavailable.");
    }
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
