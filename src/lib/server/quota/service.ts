import {
  adminGetNewApiLogs,
  adminGetNewApiUser,
  createJsonNewApiUserMappingRepository,
  isNewApiError,
  type NewApiLogListPayload,
  type NewApiLogRecord,
  type NewApiUserMappingRepository,
  type NewApiUserSelf,
} from "../integrations/new-api";
import { QuotaDisplayCache } from "./cache";
import {
  createJsonUsageLogRepository,
  type RecordUsageInput,
  type UsageLogRepository,
} from "./repository";
import {
  type BillableOperation,
  type QuotaErrorCode,
  type QuotaPrecheckResult,
  type UsageLogEntry,
  type UsagePage,
} from "./types";

export type QuotaServiceDependencies = {
  mappingRepository?: NewApiUserMappingRepository;
  usageRepository?: UsageLogRepository;
  quotaCache?: QuotaDisplayCache;
  getNewApiUser?: typeof adminGetNewApiUser;
  getNewApiLogs?: typeof adminGetNewApiLogs;
  now?: () => Date;
};

export type QuotaCheckInput = {
  localUserId: string;
  estimatedQuotaUnits: number;
  operation: BillableOperation;
  taskId: string;
  idempotencyKey: string;
};

const QUOTA_CACHE_TTL_MS = 15_000;
const quotaErrors: Record<QuotaErrorCode, { status: number; message: string }> = {
  invalid_quota_request: { status: 400, message: "Quota request is invalid." },
  quota_unavailable: { status: 503, message: "Quota is unavailable." },
  insufficient_quota: { status: 402, message: "Insufficient quota." },
  usage_unavailable: { status: 503, message: "Usage is unavailable." },
  upstream_unavailable: { status: 503, message: "New API is unavailable." },
  mapping_pending: { status: 409, message: "New API mapping is not active." },
  permission_denied: { status: 403, message: "Permission denied." },
  rate_limited: { status: 429, message: "Too many quota requests." },
};
const billableOperations = new Set<BillableOperation>([
  "cloud_image_generation",
  "cloud_video_generation",
  "cloud_image_upscale",
  "cloud_video_upscale",
]);

function isBillableOperation(value: unknown): value is BillableOperation {
  return typeof value === "string" && billableOperations.has(value as BillableOperation);
}

function quotaFailure(code: QuotaErrorCode, retryAfterSeconds?: number): QuotaPrecheckResult {
  return {
    ok: false,
    code,
    status: quotaErrors[code].status,
    message: quotaErrors[code].message,
    retryAfterSeconds,
  };
}

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function extractUser(payload: Awaited<ReturnType<typeof adminGetNewApiUser>>["data"]): NewApiUserSelf | null {
  if (!payload || typeof payload !== "object") return null;
  if ("id" in payload && typeof payload.id === "number") return payload as NewApiUserSelf;
  const root = payload as { data?: NewApiUserSelf; user?: NewApiUserSelf };
  return root.data || root.user || null;
}

function arrayFrom(value: unknown): NewApiLogRecord[] {
  return Array.isArray(value) ? value as NewApiLogRecord[] : [];
}

function extractLogs(payload: NewApiLogListPayload) {
  const root = payload as Record<string, unknown>;
  if (Array.isArray(root.data)) return { logs: arrayFrom(root.data), total: toNumber(root.total, root.data.length) };
  if (Array.isArray(root.logs)) return { logs: arrayFrom(root.logs), total: toNumber(root.total, root.logs.length) };
  if (Array.isArray(root.items)) return { logs: arrayFrom(root.items), total: toNumber(root.total, root.items.length) };

  const data = root.data as Record<string, unknown> | undefined;
  if (data) {
    if (Array.isArray(data.items)) return { logs: arrayFrom(data.items), total: toNumber(data.total, data.items.length) };
    if (Array.isArray(data.logs)) return { logs: arrayFrom(data.logs), total: toNumber(data.total, data.logs.length) };
    if (Array.isArray(data.rows)) return { logs: arrayFrom(data.rows), total: toNumber(data.total, data.rows.length) };
    if (Array.isArray(data.records)) return { logs: arrayFrom(data.records), total: toNumber(data.total, data.records.length) };
  }
  return { logs: [], total: 0 };
}

function errorToCode(error: unknown): QuotaErrorCode {
  if (isNewApiError(error)) {
    if (error.status === 429 || error.upstreamStatus === 429) return "rate_limited";
    return "upstream_unavailable";
  }
  return "quota_unavailable";
}

function nowIso(now: Date) {
  return now.toISOString();
}

function safePage(value = 1) {
  return Math.max(1, Math.floor(toNumber(value, 1)));
}

function safePageSize(value = 20) {
  return Math.min(100, Math.max(1, Math.floor(toNumber(value, 20))));
}

function nonBlank(value: string) {
  return value.trim().length > 0;
}

function usageFromLog(localUserId: string, newApiUserId: string, log: NewApiLogRecord): UsageLogEntry {
  const logId = String(log.id || log.request_id || log.task_id || `${newApiUserId}:${log.created_at || ""}`);
  const createdAt = typeof log.createdAt === "string"
    ? log.createdAt
    : typeof log.created_at === "number"
      ? new Date(log.created_at * 1000).toISOString()
      : typeof log.created_at === "string"
        ? log.created_at
        : new Date(0).toISOString();
  const quota = toNumber(log.quota, 0);
  return {
    id: `upstream:${logId}`,
    local_user_id: localUserId,
    new_api_user_id: newApiUserId,
    task_id: String(log.task_id || log.request_id || logId),
    operation: "cloud_image_generation",
    status: "succeeded",
    estimated_quota_units: quota,
    actual_quota_units: quota,
    upstream_log_id: String(log.id || ""),
    upstream_request_id: log.request_id ? String(log.request_id) : null,
    upstream_model: log.model_name ? String(log.model_name) : log.model ? String(log.model) : null,
    upstream_created_at: createdAt,
    created_at: createdAt,
    updated_at: createdAt,
    idempotency_key: `upstream:${logId}`,
    error_code: null,
    error_message: null,
  };
}

export class QuotaService {
  private readonly mappingRepository: NewApiUserMappingRepository;
  private readonly usageRepository: UsageLogRepository;
  private readonly quotaCache: QuotaDisplayCache;
  private readonly getNewApiUser: typeof adminGetNewApiUser;
  private readonly getNewApiLogs: typeof adminGetNewApiLogs;
  private readonly now: () => Date;

  constructor(dependencies: QuotaServiceDependencies = {}) {
    this.mappingRepository = dependencies.mappingRepository || createJsonNewApiUserMappingRepository();
    this.usageRepository = dependencies.usageRepository || createJsonUsageLogRepository();
    this.quotaCache = dependencies.quotaCache || new QuotaDisplayCache(QUOTA_CACHE_TTL_MS);
    this.getNewApiUser = dependencies.getNewApiUser || adminGetNewApiUser;
    this.getNewApiLogs = dependencies.getNewApiLogs || adminGetNewApiLogs;
    this.now = dependencies.now || (() => new Date());
  }

  async getCurrentQuota(localUserId: string, options: { allowCached?: boolean } = {}) {
    const cached = options.allowCached ? this.quotaCache.get(localUserId, this.now()) : null;
    if (cached) return { ok: true as const, snapshot: cached };

    const mapping = await this.mappingRepository.getByLocalUserId(localUserId);
    if (!mapping || mapping.sync_status !== "active" || !mapping.new_api_user_id) {
      return quotaFailure("mapping_pending");
    }

    try {
      const response = await this.getNewApiUser({ newApiUserId: Number(mapping.new_api_user_id) });
      const user = extractUser(response.data);
      if (!user) return quotaFailure("quota_unavailable");
      const quota = toNumber(user.quota, 0);
      const usedQuota = toNumber(user.used_quota, 0);
      const now = this.now();
      const snapshot = this.quotaCache.set(localUserId, {
        local_user_id: localUserId,
        new_api_user_id: mapping.new_api_user_id,
        quota_units: quota,
        used_quota_units: usedQuota,
        available_quota_units: Math.max(0, quota - usedQuota),
        display_unit: "credits",
        source: "new_api",
        fetched_at: nowIso(now),
        cached: false,
        cache_expires_at: nowIso(new Date(now.getTime() + QUOTA_CACHE_TTL_MS)),
      }, now);
      return { ok: true as const, snapshot };
    } catch (error) {
      return quotaFailure(errorToCode(error));
    }
  }

  async precheck(input: QuotaCheckInput): Promise<QuotaPrecheckResult> {
    if (
      !Number.isFinite(input.estimatedQuotaUnits)
      || input.estimatedQuotaUnits < 0
      || !isBillableOperation(input.operation)
      || !nonBlank(input.taskId)
      || !nonBlank(input.idempotencyKey)
    ) {
      return quotaFailure("invalid_quota_request");
    }
    const quota = await this.getCurrentQuota(input.localUserId, { allowCached: false });
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
    return {
      ok: true,
      snapshot: quota.snapshot,
      estimatedQuotaUnits: input.estimatedQuotaUnits,
      usage,
    };
  }

  async recordUsage(input: RecordUsageInput) {
    this.quotaCache.invalidate(input.localUserId);
    return this.usageRepository.record(input);
  }

  async listLocalUsage(localUserId: string, page = 1, pageSize = 20) {
    return this.usageRepository.listForUser(localUserId, safePage(page), safePageSize(pageSize));
  }

  async getTaskUsage(localUserId: string, taskId: string) {
    return this.usageRepository.getByTaskId(localUserId, taskId);
  }

  async listUpstreamUsage(localUserId: string, page = 1, pageSize = 20): Promise<UsagePage | ReturnType<typeof quotaFailure>> {
    const normalizedPage = safePage(page);
    const normalizedPageSize = safePageSize(pageSize);
    const mapping = await this.mappingRepository.getByLocalUserId(localUserId);
    if (!mapping || mapping.sync_status !== "active" || !mapping.new_api_user_id) {
      return quotaFailure("mapping_pending");
    }

    try {
      const response = await this.getNewApiLogs({
        userId: Number(mapping.new_api_user_id),
        page: normalizedPage,
        pageSize: normalizedPageSize,
      });
      const extracted = extractLogs(response.data);
      return {
        entries: extracted.logs.map((log) => usageFromLog(localUserId, mapping.new_api_user_id!, log)),
        page: normalizedPage,
        pageSize: normalizedPageSize,
        total: extracted.total,
      };
    } catch (error) {
      return quotaFailure(errorToCode(error) === "rate_limited" ? "rate_limited" : "usage_unavailable");
    }
  }
}

const defaultQuotaService = new QuotaService();

export function createQuotaService(dependencies?: QuotaServiceDependencies) {
  return new QuotaService(dependencies);
}

export function getQuotaService() {
  return defaultQuotaService;
}
