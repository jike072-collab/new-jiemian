import {
  adminCreditNewApiUserQuota,
  adminGetNewApiUser,
  adminSetNewApiUserQuota,
  createJsonNewApiUserMappingRepository,
  type NewApiUserSelf,
  type NewApiUserMappingRepository,
} from "../integrations/new-api";
import { QuotaDisplayCache } from "./cache";
import {
  createJsonUsageLogRepository,
  type RecordUsageInput,
  type UsageLogRepository,
} from "./repository";
import {
  TaskBillingRepositoryError,
  type TaskBillingRecordPatch,
  type TaskBillingRepository,
} from "./task-billing-repository";
import { createTaskBillingPersistenceRepositories } from "./task-billing-persistence";
import {
  type TaskBillingFailInput,
  type TaskBillingFailure,
  type TaskBillingPrecheckInput,
  type TaskBillingRecord,
  type TaskBillingResult,
  type TaskBillingSettleInput,
  type TaskBillingAcceptInput,
} from "./task-billing-types";
import {
  type BillableOperation,
  type QuotaErrorCode,
  type QuotaSnapshot,
} from "./types";
import { QuotaService } from "./service";

export type AdjustQuotaInput = {
  localUserId: string;
  newApiUserId: string;
  taskId: string;
  quotaDelta: number;
  idempotencyKey: string;
  originalQuota?: number | null;
  targetQuota?: number | null;
};

export type AdjustQuotaResult = {
  ok: true;
  providerAdjustmentId: string;
} | {
  ok: false;
  code: string;
  message: string;
  retryable: boolean;
};

export type ProviderQuotaResult = {
  ok: true;
  quota: number;
} | {
  ok: false;
  code: string;
  message: string;
  retryable: boolean;
};

export type TaskBillingServiceDependencies = {
  taskRepository?: TaskBillingRepository;
  usageRepository?: UsageLogRepository;
  mappingRepository?: NewApiUserMappingRepository;
  quotaCache?: QuotaDisplayCache;
  getQuotaSnapshot?: (localUserId: string) => Promise<{ ok: true; snapshot: QuotaSnapshot } | TaskBillingFailure>;
  getProviderQuota?: (newApiUserId: string) => Promise<ProviderQuotaResult>;
  adjustQuota?: (input: AdjustQuotaInput) => Promise<AdjustQuotaResult>;
  now?: () => Date;
};

const billableOperations = new Set<BillableOperation>([
  "cloud_image_generation",
  "cloud_video_generation",
  "cloud_image_upscale",
  "cloud_video_upscale",
]);

const quotaErrors: Record<QuotaErrorCode, { status: number; message: string; retryable: boolean }> = {
  invalid_quota_request: { status: 400, message: "Quota request is invalid.", retryable: false },
  quota_unavailable: { status: 503, message: "Quota is unavailable.", retryable: true },
  insufficient_quota: { status: 402, message: "Insufficient quota.", retryable: false },
  usage_unavailable: { status: 503, message: "Usage is unavailable.", retryable: true },
  upstream_unavailable: { status: 503, message: "New API is unavailable.", retryable: true },
  mapping_pending: { status: 409, message: "New API mapping is not active.", retryable: true },
  permission_denied: { status: 403, message: "Permission denied.", retryable: false },
  rate_limited: { status: 429, message: "Too many quota requests.", retryable: true },
};

function nowIso(now: Date) {
  return now.toISOString();
}

function nonBlank(value: string | null | undefined) {
  return typeof value === "string" && value.trim().length > 0;
}

function isBillableOperation(value: unknown): value is BillableOperation {
  return typeof value === "string" && billableOperations.has(value as BillableOperation);
}

function failure(input: Omit<TaskBillingFailure, "ok">): TaskBillingFailure {
  return { ok: false, ...input };
}

function quotaFailure(code: QuotaErrorCode): TaskBillingFailure {
  return failure({
    code,
    status: quotaErrors[code].status,
    message: quotaErrors[code].message,
    retryable: quotaErrors[code].retryable,
  });
}

function invalidTaskBillingRequest() {
  return failure({
    code: "invalid_task_billing_request",
    status: 400,
    message: "Task billing request is invalid.",
    retryable: false,
  });
}

function sanitizeError(value?: string | null) {
  if (!value) return null;
  return String(value)
    .replace(/postgres(?:ql)?:\/\/[^,\s}]+/gi, "[REDACTED_DATABASE_URL]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/Authorization[=:]\s*[^,\s}]+/gi, "Authorization=[REDACTED]")
    .replace(/(token|password|cookie|secret|key|signature)[=:]\s*[^,\s}]+/gi, "$1=[REDACTED]")
    .slice(0, 300);
}

function errorFailure(error: unknown): TaskBillingFailure {
  if (error instanceof TaskBillingRepositoryError && error.code === "TASK_BILLING_VERSION_CONFLICT") {
    return failure({
      code: "task_billing_conflict",
      status: 409,
      message: "Task billing state changed before update.",
      retryable: true,
    });
  }
  return failure({
    code: "task_billing_unavailable",
    status: 503,
    message: "Task billing is unavailable.",
    retryable: true,
  });
}

function isTaskBillingFailure(value: TaskBillingRecord | null | TaskBillingFailure): value is TaskBillingFailure {
  return Boolean(value && "ok" in value && value.ok === false);
}

async function defaultAdjustQuota(input: AdjustQuotaInput): Promise<AdjustQuotaResult> {
  try {
    if (Number.isInteger(input.targetQuota)) {
      await adminSetNewApiUserQuota({
        newApiUserId: Number(input.newApiUserId),
        quota: input.targetQuota!,
      });
    } else {
      await adminCreditNewApiUserQuota({
        newApiUserId: Number(input.newApiUserId),
        quotaDelta: input.quotaDelta,
      });
    }
    return {
      ok: true,
      providerAdjustmentId: `new-api:${input.taskId}:${input.idempotencyKey}`,
    };
  } catch (error) {
    return {
      ok: false,
      code: error instanceof Error ? error.name : "NEW_API_QUOTA_ADJUST_FAILED",
      message: "New API quota adjustment failed.",
      retryable: true,
    };
  }
}

function isNewApiUserSelf(value: unknown): value is NewApiUserSelf {
  return Boolean(value && typeof value === "object" && "id" in value);
}

function extractNewApiUserQuota(payload: { data?: NewApiUserSelf; user?: NewApiUserSelf } | NewApiUserSelf | null | undefined): number | null {
  if (!payload || typeof payload !== "object") return null;
  const direct = isNewApiUserSelf(payload) ? payload.quota : undefined;
  const nestedData = "data" in payload && isNewApiUserSelf(payload.data) ? payload.data.quota : undefined;
  const nestedUser = "user" in payload && isNewApiUserSelf(payload.user) ? payload.user.quota : undefined;
  const quota = Number(direct ?? nestedData ?? nestedUser);
  return Number.isFinite(quota) ? quota : null;
}

async function defaultGetProviderQuota(newApiUserId: string): Promise<ProviderQuotaResult> {
  try {
    const response = await adminGetNewApiUser({ newApiUserId: Number(newApiUserId) });
    const quota = extractNewApiUserQuota(response.data);
    if (quota === null) {
      return {
        ok: false,
        code: "NEW_API_QUOTA_READ_INVALID",
        message: "New API quota read returned an invalid value.",
        retryable: true,
      };
    }
    return { ok: true, quota };
  } catch (error) {
    return {
      ok: false,
      code: error instanceof Error ? error.name : "NEW_API_QUOTA_READ_FAILED",
      message: "New API quota read failed.",
      retryable: true,
    };
  }
}

export class TaskBillingService {
  private readonly taskRepository: TaskBillingRepository;
  private readonly usageRepository: UsageLogRepository;
  private readonly mappingRepository: NewApiUserMappingRepository;
  private readonly quotaCache: QuotaDisplayCache;
  private readonly getQuotaSnapshot: NonNullable<TaskBillingServiceDependencies["getQuotaSnapshot"]>;
  private readonly getProviderQuota: (newApiUserId: string) => Promise<ProviderQuotaResult>;
  private readonly adjustQuota: (input: AdjustQuotaInput) => Promise<AdjustQuotaResult>;
  private readonly now: () => Date;
  private readonly taskLocks = new Map<string, Promise<void>>();

  constructor(dependencies: TaskBillingServiceDependencies = {}) {
    const persistence = dependencies.taskRepository && dependencies.usageRepository && dependencies.mappingRepository
      ? null
      : createTaskBillingPersistenceRepositories();
    this.taskRepository = dependencies.taskRepository || persistence!.taskRepository;
    this.usageRepository = dependencies.usageRepository || persistence!.usageRepository || createJsonUsageLogRepository();
    this.mappingRepository = dependencies.mappingRepository || persistence!.mappingRepository || createJsonNewApiUserMappingRepository();
    this.quotaCache = dependencies.quotaCache || new QuotaDisplayCache(15_000);
    this.getQuotaSnapshot = dependencies.getQuotaSnapshot || this.defaultQuotaSnapshot.bind(this);
    this.getProviderQuota = dependencies.getProviderQuota || defaultGetProviderQuota;
    this.adjustQuota = dependencies.adjustQuota || defaultAdjustQuota;
    this.now = dependencies.now || (() => new Date());
  }

  async precheck(input: TaskBillingPrecheckInput): Promise<TaskBillingResult> {
    if (
      !nonBlank(input.localUserId)
      || !nonBlank(input.taskId)
      || !nonBlank(input.idempotencyKey)
      || !isBillableOperation(input.operation)
      || !Number.isInteger(input.estimatedQuotaUnits)
      || input.estimatedQuotaUnits < 0
    ) {
      return invalidTaskBillingRequest();
    }

    const existing = await this.safeGetExisting(input.localUserId, input.idempotencyKey, input.taskId);
    if (isTaskBillingFailure(existing)) return existing;
    if (existing) {
      return { ok: true, status: 200, action: "idempotent", record: existing };
    }

    const quota = await this.getQuotaSnapshot(input.localUserId);
    if (!quota.ok) return quota;
    if (quota.snapshot.available_quota_units < input.estimatedQuotaUnits) {
      await this.recordUsage({
        localUserId: input.localUserId,
        newApiUserId: quota.snapshot.new_api_user_id,
        taskId: input.taskId,
        operation: input.operation,
        status: "failed",
        estimatedQuotaUnits: input.estimatedQuotaUnits,
        actualQuotaUnits: null,
        idempotencyKey: input.idempotencyKey,
        errorCode: "insufficient_quota",
        errorMessage: "Insufficient quota for estimated task cost.",
      });
      return quotaFailure("insufficient_quota");
    }

    try {
      const usage = await this.recordUsage({
        localUserId: input.localUserId,
        newApiUserId: quota.snapshot.new_api_user_id,
        taskId: input.taskId,
        operation: input.operation,
        status: "prechecked",
        estimatedQuotaUnits: input.estimatedQuotaUnits,
        actualQuotaUnits: null,
        idempotencyKey: input.idempotencyKey,
      });
      const record = await this.taskRepository.createPrecheck({
        localUserId: input.localUserId,
        taskId: input.taskId,
        usageRecordId: usage.id,
        idempotencyKey: input.idempotencyKey,
        estimatedQuotaUnits: input.estimatedQuotaUnits,
        now: this.now(),
      });
      return { ok: true, status: 201, action: "prechecked", record, usage };
    } catch (error) {
      const duplicate = await this.safeGetExisting(input.localUserId, input.idempotencyKey, input.taskId);
      if (isTaskBillingFailure(duplicate)) return duplicate;
      if (duplicate) return { ok: true, status: 200, action: "idempotent", record: duplicate };
      return errorFailure(error);
    }
  }

  async accept(input: TaskBillingAcceptInput): Promise<TaskBillingResult> {
    if (!nonBlank(input.localUserId) || !nonBlank(input.taskId)) return invalidTaskBillingRequest();
    const record = await this.safeGetByTaskId(input.localUserId, input.taskId);
    if (isTaskBillingFailure(record)) return record;
    if (!record) return this.notFound();
    if (record.billing_state !== "prechecked") {
      return { ok: true, status: 200, action: "idempotent", record };
    }
    const usage = await this.updateUsageForRecord(record, {
      status: "accepted",
      actualQuotaUnits: null,
      upstreamRequestId: input.upstreamRequestId || null,
      upstreamModel: input.upstreamModel || null,
    });
    const updated = await this.updateWithRetry(record, {
      billing_state: "accepted",
      new_api_task_id: input.newApiTaskId || record.new_api_task_id,
      usage_record_id: usage?.id || record.usage_record_id,
      updated_at: nowIso(this.now()),
      last_error: null,
    });
    if (!updated.ok) return updated;
    return { ok: true, status: 200, action: "accepted", record: updated.record, usage: usage || undefined };
  }

  async settleSuccess(input: TaskBillingSettleInput): Promise<TaskBillingResult> {
    if (!nonBlank(input.localUserId) || !nonBlank(input.taskId)) return invalidTaskBillingRequest();
    return this.withTaskLock(input.localUserId, input.taskId, () => this.settleSuccessLocked(input));
  }

  private async settleSuccessLocked(input: TaskBillingSettleInput): Promise<TaskBillingResult> {
    if (
      !nonBlank(input.localUserId)
      || !nonBlank(input.taskId)
      || !Number.isInteger(input.actualQuotaUnits)
      || input.actualQuotaUnits < 0
    ) {
      return invalidTaskBillingRequest();
    }
    const record = await this.safeGetByTaskId(input.localUserId, input.taskId);
    if (isTaskBillingFailure(record)) return record;
    if (!record) return this.notFound();
    if (record.billing_state === "settled") {
      return { ok: true, status: 200, action: "idempotent", record };
    }
    if (record.billing_state === "reconciliation_required") return this.completeSettlement(record, input);
    if (record.billing_state === "failed" || record.billing_state === "cancelled") {
      return this.markReconciliationRequired(record, "Cannot settle a failed or cancelled task.");
    }

    const prepared = await this.claimForExternalAdjustment(record, {
      billing_state: "reconciliation_required",
      new_api_task_id: input.newApiTaskId || record.new_api_task_id,
      updated_at: nowIso(this.now()),
      last_error: "Task settlement pending external quota adjustment.",
    });
    if (!prepared.ok) return prepared;
    if (!prepared.claimed) {
      if (prepared.record.billing_state === "settled") {
        return { ok: true, status: 200, action: "idempotent", record: prepared.record };
      }
      if (prepared.record.billing_state === "reconciliation_required") {
        return this.completeSettlement(prepared.record, input);
      }
      return { ok: true, status: 202, action: "reconciliation_required", record: prepared.record };
    }

    return this.completeSettlement(prepared.record, input);
  }

  private async completeSettlement(record: TaskBillingRecord, input: TaskBillingSettleInput): Promise<TaskBillingResult> {
    const mapping = await this.mappingRepository.getByLocalUserId(input.localUserId);
    if (!mapping || mapping.sync_status !== "active" || !mapping.new_api_user_id) return quotaFailure("mapping_pending");

    const charge = await this.applyIdempotentQuotaAdjustment({
      localUserId: input.localUserId,
      newApiUserId: mapping.new_api_user_id,
      taskId: input.taskId,
      quotaDelta: -input.actualQuotaUnits,
      idempotencyKey: `task-settle:${record.id}`,
      taskBillingRecordId: record.id,
    });
    if (!charge.ok) return this.markReconciliationRequired(record, charge.message);

    const timestamp = nowIso(this.now());
    const usage = await this.updateUsageForRecord(record, {
      newApiUserId: mapping.new_api_user_id,
      status: "succeeded",
      actualQuotaUnits: input.actualQuotaUnits,
      upstreamLogId: input.upstreamLogId || null,
      upstreamRequestId: input.upstreamRequestId || null,
      upstreamModel: input.upstreamModel || null,
    });
    const updated = await this.updateWithRetry(record, {
      billing_state: "settled",
      new_api_task_id: input.newApiTaskId || record.new_api_task_id,
      usage_record_id: usage?.id || record.usage_record_id,
      final_quota_units: input.actualQuotaUnits,
      settled_at: timestamp,
      updated_at: timestamp,
      last_error: null,
    });
    if (!updated.ok) return updated;
    return { ok: true, status: 200, action: "settled", record: updated.record, usage: usage || undefined };
  }

  async fail(input: TaskBillingFailInput): Promise<TaskBillingResult> {
    return this.finishWithoutCharge(input, "failed");
  }

  async cancel(input: TaskBillingFailInput): Promise<TaskBillingResult> {
    return this.finishWithoutCharge(input, "cancelled");
  }

  private async finishWithoutCharge(input: TaskBillingFailInput, state: "failed" | "cancelled"): Promise<TaskBillingResult> {
    if (!nonBlank(input.localUserId) || !nonBlank(input.taskId)) return invalidTaskBillingRequest();
    return this.withTaskLock(input.localUserId, input.taskId, () => this.finishWithoutChargeLocked(input, state));
  }

  private async finishWithoutChargeLocked(input: TaskBillingFailInput, state: "failed" | "cancelled"): Promise<TaskBillingResult> {
    if (!nonBlank(input.localUserId) || !nonBlank(input.taskId)) return invalidTaskBillingRequest();
    const record = await this.safeGetByTaskId(input.localUserId, input.taskId);
    if (isTaskBillingFailure(record)) return record;
    if (!record) return this.notFound();
    if (
      record.billing_state === state
      || record.billing_state === "failed"
      || record.billing_state === "cancelled"
    ) {
      return { ok: true, status: 200, action: "idempotent", record };
    }
    if (record.billing_state === "reconciliation_required") {
      if (record.final_quota_units && !record.refunded_at) {
        return this.refundSettledTask(record, state, input.reason || `${state} after settlement`);
      }
      return { ok: true, status: 202, action: "reconciliation_required", record };
    }
    if (record.billing_state === "settled") {
      const refunded = await this.refundSettledTask(record, state, input.reason || `${state} after settlement`);
      if (!refunded.ok) return refunded;
      return refunded;
    }

    const usage = await this.updateUsageForRecord(record, {
      status: state,
      actualQuotaUnits: 0,
      upstreamRequestId: input.upstreamRequestId || null,
      upstreamModel: input.upstreamModel || null,
      errorCode: state,
      errorMessage: input.reason || state,
    });
    const updated = await this.updateWithRetry(record, {
      billing_state: state,
      new_api_task_id: input.newApiTaskId || record.new_api_task_id,
      usage_record_id: usage?.id || record.usage_record_id,
      final_quota_units: 0,
      updated_at: nowIso(this.now()),
      last_error: sanitizeError(input.reason || state),
    });
    if (!updated.ok) return updated;
    return { ok: true, status: 200, action: state, record: updated.record, usage: usage || undefined };
  }

  private async refundSettledTask(record: TaskBillingRecord, targetState: "failed" | "cancelled", reason: string): Promise<TaskBillingResult> {
    const finalQuota = record.final_quota_units || 0;
    if (record.refunded_at || finalQuota === 0) {
      return { ok: true, status: 200, action: "idempotent", record };
    }
    const prepared = await this.claimForExternalAdjustment(record, {
      billing_state: "reconciliation_required",
      updated_at: nowIso(this.now()),
      last_error: sanitizeError(reason),
    });
    if (!prepared.ok) return prepared;
    if (!prepared.claimed) {
      if (prepared.record.refunded_at || prepared.record.billing_state === targetState) {
        return { ok: true, status: 200, action: "idempotent", record: prepared.record };
      }
      return { ok: true, status: 202, action: "reconciliation_required", record: prepared.record };
    }
    const mapping = await this.mappingRepository.getByLocalUserId(record.local_user_id);
    if (!mapping || mapping.sync_status !== "active" || !mapping.new_api_user_id) return quotaFailure("mapping_pending");
    const refund = await this.applyIdempotentQuotaAdjustment({
      localUserId: record.local_user_id,
      newApiUserId: mapping.new_api_user_id,
      taskId: record.task_id,
      quotaDelta: finalQuota,
      idempotencyKey: `task-refund:${prepared.record.id}`,
      taskBillingRecordId: prepared.record.id,
    });
    if (!refund.ok) return this.markReconciliationRequired(prepared.record, refund.message);
    const usage = await this.updateUsageForRecord(prepared.record, {
      newApiUserId: mapping.new_api_user_id,
      status: "refunded",
      actualQuotaUnits: 0,
      errorCode: "task_refunded",
      errorMessage: reason,
    });
    const timestamp = nowIso(this.now());
    const updated = await this.updateWithRetry(prepared.record, {
      billing_state: targetState,
      usage_record_id: usage?.id || prepared.record.usage_record_id,
      refunded_at: timestamp,
      updated_at: timestamp,
      last_error: sanitizeError(reason),
    });
    if (!updated.ok) return updated;
    return { ok: true, status: 200, action: "refunded", record: updated.record, usage: usage || undefined };
  }

  private async markReconciliationRequired(record: TaskBillingRecord, reason: string): Promise<TaskBillingResult> {
    const usage = await this.updateUsageForRecord(record, {
      status: "reconciliation_required",
      actualQuotaUnits: record.final_quota_units,
      errorCode: "reconciliation_required",
      errorMessage: reason,
    }).catch(() => null);
    const updated = await this.updateWithRetry(record, {
      billing_state: "reconciliation_required",
      usage_record_id: usage?.id || record.usage_record_id,
      updated_at: nowIso(this.now()),
      last_error: sanitizeError(reason),
    });
    if (!updated.ok) return updated;
    return { ok: true, status: 202, action: "reconciliation_required", record: updated.record, usage: usage || undefined };
  }

  private async applyIdempotentQuotaAdjustment(input: AdjustQuotaInput & {
    taskBillingRecordId: string;
  }): Promise<AdjustQuotaResult | TaskBillingFailure> {
    const operation = async (): Promise<AdjustQuotaResult | TaskBillingFailure> => {
      try {
        const currentQuota = await this.getProviderQuota(input.newApiUserId);
        if (!currentQuota.ok) return currentQuota;
        const originalQuota = input.originalQuota ?? currentQuota.quota;
        const targetQuota = input.targetQuota ?? originalQuota + input.quotaDelta;
        const adjustment = this.taskRepository.claimQuotaAdjustment
          ? await this.taskRepository.claimQuotaAdjustment({
            localUserId: input.localUserId,
            newApiUserId: input.newApiUserId,
            taskBillingRecordId: input.taskBillingRecordId,
            taskId: input.taskId,
            idempotencyKey: input.idempotencyKey,
            quotaDelta: input.quotaDelta,
            originalQuota,
            targetQuota,
            now: this.now(),
          })
          : null;
        if (adjustment?.status === "applied") {
          return {
            ok: true,
            providerAdjustmentId: adjustment.provider_adjustment_id || `task-quota:${input.idempotencyKey}`,
          };
        }
        const persistedOriginalQuota = adjustment?.original_quota ?? originalQuota;
        const persistedTargetQuota = adjustment?.target_quota ?? targetQuota;
        if (adjustment && !adjustment.created && currentQuota.quota === persistedTargetQuota) {
          const providerAdjustmentId = `new-api:${input.taskId}:${input.idempotencyKey}:recovered`;
          if (this.taskRepository.markQuotaAdjustmentApplied) {
            await this.taskRepository.markQuotaAdjustmentApplied(input.idempotencyKey, providerAdjustmentId, this.now());
          }
          return { ok: true, providerAdjustmentId };
        }
        if (adjustment && !adjustment.created && currentQuota.quota !== persistedOriginalQuota) {
          const message = "New API quota changed outside the pending task adjustment.";
          if (this.taskRepository.markQuotaAdjustmentFailed) {
            await this.taskRepository.markQuotaAdjustmentFailed(input.idempotencyKey, message, this.now())
              .catch(() => undefined);
          }
          return {
            ok: false,
            code: "TASK_QUOTA_RECONCILIATION_REQUIRED",
            message,
            retryable: false,
          };
        }
        const result = await this.adjustQuota({
          ...input,
          originalQuota: persistedOriginalQuota,
          targetQuota: persistedTargetQuota,
        });
        if (!result.ok) {
          if (this.taskRepository.markQuotaAdjustmentFailed) {
            await this.taskRepository.markQuotaAdjustmentFailed(input.idempotencyKey, sanitizeError(result.message) || result.code, this.now())
              .catch(() => undefined);
          }
          return result;
        }
        if (this.taskRepository.markQuotaAdjustmentApplied) {
          await this.taskRepository.markQuotaAdjustmentApplied(input.idempotencyKey, result.providerAdjustmentId, this.now());
        }
        return result;
      } catch (error) {
        return errorFailure(error);
      }
    };
    if (this.taskRepository.withQuotaAdjustmentLock) {
      return this.taskRepository.withQuotaAdjustmentLock(input.newApiUserId, operation);
    }
    return operation();
  }

  private async updateWithRetry(
    record: TaskBillingRecord,
    patch: TaskBillingRecordPatch,
    attempt = 0,
  ): Promise<{ ok: true; record: TaskBillingRecord } | TaskBillingFailure> {
    try {
      return { ok: true, record: await this.taskRepository.update(record.id, patch, record.version) };
    } catch (error) {
      if (!(error instanceof TaskBillingRepositoryError) || error.code !== "TASK_BILLING_VERSION_CONFLICT" || attempt >= 3) {
        return errorFailure(error);
      }
      const fresh = await this.taskRepository.getByTaskId(record.local_user_id, record.task_id);
      if (!fresh) return this.notFound();
      if (fresh.billing_state === "settled" || fresh.refunded_at) return { ok: true, record: fresh };
      return this.updateWithRetry(fresh, patch, attempt + 1);
    }
  }

  private async claimForExternalAdjustment(
    record: TaskBillingRecord,
    patch: TaskBillingRecordPatch,
    attempt = 0,
  ): Promise<{ ok: true; claimed: boolean; record: TaskBillingRecord } | TaskBillingFailure> {
    try {
      return {
        ok: true,
        claimed: true,
        record: await this.taskRepository.update(record.id, patch, record.version),
      };
    } catch (error) {
      if (!(error instanceof TaskBillingRepositoryError) || error.code !== "TASK_BILLING_VERSION_CONFLICT" || attempt >= 3) {
        return errorFailure(error);
      }
      const fresh = await this.safeGetByTaskId(record.local_user_id, record.task_id);
      if (isTaskBillingFailure(fresh)) return fresh;
      if (!fresh) return this.notFound();
      if (
        fresh.billing_state === "settled"
        || fresh.billing_state === "reconciliation_required"
        || fresh.billing_state === "failed"
        || fresh.billing_state === "cancelled"
        || fresh.refunded_at
      ) {
        return { ok: true, claimed: false, record: fresh };
      }
      return this.claimForExternalAdjustment(fresh, patch, attempt + 1);
    }
  }

  private async safeGetByTaskId(localUserId: string, taskId: string): Promise<TaskBillingRecord | null | TaskBillingFailure> {
    try {
      return await this.taskRepository.getByTaskId(localUserId, taskId);
    } catch (error) {
      return errorFailure(error);
    }
  }

  private async safeGetExisting(localUserId: string, idempotencyKey: string, taskId: string): Promise<TaskBillingRecord | null | TaskBillingFailure> {
    try {
      return await this.taskRepository.getByIdempotencyKey(localUserId, idempotencyKey)
        || await this.taskRepository.getByTaskId(localUserId, taskId);
    } catch (error) {
      return errorFailure(error);
    }
  }

  private async withTaskLock<T>(localUserId: string, taskId: string, operation: () => Promise<T>) {
    const key = `${localUserId.trim()}:${taskId.trim()}`;
    const previous = this.taskLocks.get(key) || Promise.resolve();
    let release: () => void = () => undefined;
    const current = previous.then(() => new Promise<void>((resolve) => {
      release = resolve;
    }));
    this.taskLocks.set(key, current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.taskLocks.get(key) === current) this.taskLocks.delete(key);
    }
  }

  private async updateUsageForRecord(record: TaskBillingRecord, patch: Partial<RecordUsageInput>) {
    const existingUsage = await this.findUsage(record);
    return this.recordUsage({
      localUserId: record.local_user_id,
      newApiUserId: patch.newApiUserId === undefined ? existingUsage?.new_api_user_id || null : patch.newApiUserId,
      taskId: record.task_id,
      operation: existingUsage?.operation || "cloud_image_generation",
      status: patch.status || existingUsage?.status || "prechecked",
      estimatedQuotaUnits: record.estimated_quota_units,
      actualQuotaUnits: patch.actualQuotaUnits === undefined ? existingUsage?.actual_quota_units ?? null : patch.actualQuotaUnits,
      upstreamLogId: patch.upstreamLogId === undefined ? existingUsage?.upstream_log_id || null : patch.upstreamLogId,
      upstreamRequestId: patch.upstreamRequestId === undefined ? existingUsage?.upstream_request_id || null : patch.upstreamRequestId,
      upstreamModel: patch.upstreamModel === undefined ? existingUsage?.upstream_model || null : patch.upstreamModel,
      upstreamCreatedAt: patch.upstreamCreatedAt === undefined ? existingUsage?.upstream_created_at || null : patch.upstreamCreatedAt,
      idempotencyKey: record.idempotency_key,
      errorCode: patch.errorCode === undefined ? existingUsage?.error_code || null : patch.errorCode,
      errorMessage: patch.errorMessage === undefined ? existingUsage?.error_message || null : patch.errorMessage,
      now: this.now(),
    });
  }

  private async findUsage(record: TaskBillingRecord) {
    return this.usageRepository.getByTaskId(record.local_user_id, record.task_id);
  }

  private async recordUsage(input: RecordUsageInput) {
    this.quotaCache.invalidate(input.localUserId);
    return this.usageRepository.record({
      ...input,
      errorMessage: sanitizeError(input.errorMessage),
    });
  }

  private async defaultQuotaSnapshot(localUserId: string) {
    const quotaService = new QuotaService({
      mappingRepository: this.mappingRepository,
      usageRepository: this.usageRepository,
      quotaCache: this.quotaCache,
      now: this.now,
    });
    const result = await quotaService.getCurrentQuota(localUserId, { allowCached: false });
    return result.ok ? result : quotaFailure(result.code);
  }

  private notFound(): TaskBillingFailure {
    return failure({
      code: "task_billing_not_found",
      status: 404,
      message: "Task billing record was not found.",
      retryable: false,
    });
  }
}

let defaultTaskBillingService: TaskBillingService | null = null;

export function createTaskBillingService(dependencies?: TaskBillingServiceDependencies) {
  return new TaskBillingService(dependencies);
}

export function getTaskBillingService() {
  defaultTaskBillingService ||= new TaskBillingService();
  return defaultTaskBillingService;
}
