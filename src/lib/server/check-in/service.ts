import {
  adminGetNewApiUser,
  adminSetNewApiUserQuota,
  creditsToNewApiQuota,
  getNewApiQuotaDisplayConfig,
  newApiQuotaToCredits,
  type NewApiQuotaDisplayConfig,
  type NewApiUserMappingRepository,
  type NewApiUserSelf,
} from "../integrations/new-api";
import { createTaskBillingPersistenceRepositories, getQuotaService } from "../quota";
import { type TaskBillingRepository } from "../quota/task-billing-repository";
import { createPostgresDailyCheckInRepository } from "./postgres-repository";
import {
  createJsonDailyCheckInRepository,
  type DailyCheckInRecord,
  type DailyCheckInRepository,
} from "./repository";

export const DAILY_CHECK_IN_REWARD_CREDITS = 200;
export const DAILY_CHECK_IN_TIME_ZONE = "Asia/Shanghai";

export type PublicDailyCheckInStatus = {
  status: "available" | "checked";
  check_in_date: string;
  reward_quota: number;
  time_zone: typeof DAILY_CHECK_IN_TIME_ZONE;
  next_reset_at: string;
  claimed_at: string | null;
};

export type PublicDailyCheckInRecord = {
  id: string;
  check_in_date: string;
  quota_delta: number;
  balance_after_quota_units?: number | null;
  status: "credited";
  created_at: string;
};

export type DailyCheckInFailureCode =
  | "checkin_unavailable"
  | "checkin_conflict"
  | "mapping_pending"
  | "quota_unavailable";

export type DailyCheckInFailure = {
  ok: false;
  status: number;
  code: DailyCheckInFailureCode;
  message: string;
};

export type DailyCheckInStatusResult = {
  ok: true;
  status: 200;
  checkIn: PublicDailyCheckInStatus;
  records: PublicDailyCheckInRecord[];
};

export type DailyCheckInClaimResult = DailyCheckInStatusResult & {
  action: "credited" | "already_checked";
  quota_delta: number;
};

export type DailyCheckInServiceDependencies = {
  repository?: DailyCheckInRepository;
  mappingRepository?: NewApiUserMappingRepository;
  taskRepository?: TaskBillingRepository;
  getQuotaDisplayConfig?: () => Promise<NewApiQuotaDisplayConfig>;
  getProviderQuota?: (newApiUserId: string) => Promise<number>;
  setProviderQuota?: (newApiUserId: string, quota: number) => Promise<void>;
  invalidateQuota?: (localUserId: string) => void;
  now?: () => Date;
};

function failure(code: DailyCheckInFailureCode, status: number, message: string): DailyCheckInFailure {
  return { ok: false, code, status, message };
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

async function defaultGetProviderQuota(newApiUserId: string, getQuotaDisplayConfig: () => Promise<NewApiQuotaDisplayConfig>) {
  const response = await adminGetNewApiUser({ newApiUserId: Number(newApiUserId) });
  const user = extractUser(response.data);
  if (!user) throw new Error("New API quota read failed.");
  const quotaDisplayConfig = await getQuotaDisplayConfig();
  return newApiQuotaToCredits(Math.max(0, toNumber(user.quota, 0)), quotaDisplayConfig);
}

async function defaultSetProviderQuota(newApiUserId: string, quota: number, getQuotaDisplayConfig: () => Promise<NewApiQuotaDisplayConfig>) {
  const quotaDisplayConfig = await getQuotaDisplayConfig();
  await adminSetNewApiUserQuota({
    newApiUserId: Number(newApiUserId),
    quota: creditsToNewApiQuota(quota, quotaDisplayConfig),
  });
}

function beijingDate(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DAILY_CHECK_IN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function nextResetAt(checkInDate: string) {
  const [year, month, day] = checkInDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1, -8, 0, 0, 0)).toISOString();
}

function publicStatus(checkInDate: string, record: DailyCheckInRecord | null): PublicDailyCheckInStatus {
  const checked = record?.status === "credited";
  return {
    status: checked ? "checked" : "available",
    check_in_date: checkInDate,
    reward_quota: DAILY_CHECK_IN_REWARD_CREDITS,
    time_zone: DAILY_CHECK_IN_TIME_ZONE,
    next_reset_at: nextResetAt(checkInDate),
    claimed_at: checked ? record.claimed_at || record.updated_at : null,
  };
}

function publicRecords(records: DailyCheckInRecord[], balanceByDate: Map<string, number | null> = new Map()): PublicDailyCheckInRecord[] {
  return records
    .filter((record) => record.status === "credited")
    .map((record) => ({
      id: record.id,
      check_in_date: record.checkin_date,
      quota_delta: record.quota_delta,
      balance_after_quota_units: balanceByDate.get(record.checkin_date) ?? null,
      status: "credited",
      created_at: record.claimed_at || record.updated_at || record.created_at,
    }));
}

async function checkInBalanceByDate(
  taskRepository: TaskBillingRepository,
  localUserId: string,
  records: DailyCheckInRecord[],
) {
  const creditedDates = Array.from(new Set(records
    .filter((record) => record.status === "credited")
    .map((record) => record.checkin_date)));
  if (!creditedDates.length || !taskRepository.getQuotaAdjustmentByTaskId) return new Map<string, number | null>();

  const entries = await Promise.all(creditedDates.map(async (checkInDate) => {
    const adjustment = await taskRepository.getQuotaAdjustmentByTaskId!(localUserId, taskId(checkInDate)).catch(() => null);
    return [
      checkInDate,
      adjustment?.status === "applied" ? adjustment.target_quota ?? null : null,
    ] as const;
  }));
  return new Map(entries);
}

function idempotencyKey(localUserId: string, checkInDate: string) {
  return `daily-checkin:${localUserId.trim()}:${checkInDate}`;
}

function taskId(checkInDate: string) {
  return `daily-checkin:${checkInDate}`;
}

function adjustmentConflicts(
  adjustment: {
    local_user_id: string;
    new_api_user_id: string;
    task_id: string;
    quota_delta: number;
  },
  input: { localUserId: string; newApiUserId: string; checkInDate: string },
) {
  const conflicts: string[] = [];
  if (adjustment.local_user_id !== input.localUserId) conflicts.push("local_user_id");
  if (adjustment.new_api_user_id !== input.newApiUserId) conflicts.push("new_api_user_id");
  if (adjustment.task_id !== taskId(input.checkInDate)) conflicts.push("task_id");
  if (adjustment.quota_delta !== DAILY_CHECK_IN_REWARD_CREDITS) conflicts.push("quota_delta");
  return conflicts;
}

export class DailyCheckInService {
  private readonly repository: DailyCheckInRepository;
  private readonly mappingRepository: NewApiUserMappingRepository;
  private readonly taskRepository: TaskBillingRepository;
  private readonly getProviderQuota: (newApiUserId: string) => Promise<number>;
  private readonly setProviderQuota: (newApiUserId: string, quota: number) => Promise<void>;
  private readonly invalidateQuota: (localUserId: string) => void;
  private readonly now: () => Date;

  constructor(dependencies: DailyCheckInServiceDependencies = {}) {
    const persistence = dependencies.mappingRepository && dependencies.taskRepository && dependencies.repository
      ? null
      : createTaskBillingPersistenceRepositories();
    const getQuotaDisplayConfig = dependencies.getQuotaDisplayConfig || getNewApiQuotaDisplayConfig;
    this.repository = dependencies.repository || (
      persistence!.mode === "postgres"
        ? createPostgresDailyCheckInRepository()
        : createJsonDailyCheckInRepository()
    );
    this.mappingRepository = dependencies.mappingRepository || persistence!.mappingRepository;
    this.taskRepository = dependencies.taskRepository || persistence!.taskRepository;
    this.getProviderQuota = dependencies.getProviderQuota || ((newApiUserId) => defaultGetProviderQuota(newApiUserId, getQuotaDisplayConfig));
    this.setProviderQuota = dependencies.setProviderQuota || ((newApiUserId, quota) => defaultSetProviderQuota(newApiUserId, quota, getQuotaDisplayConfig));
    this.invalidateQuota = dependencies.invalidateQuota || ((localUserId) => getQuotaService().invalidateCache(localUserId));
    this.now = dependencies.now || (() => new Date());
  }

  async getStatus(localUserId: string): Promise<DailyCheckInStatusResult> {
    const checkInDate = beijingDate(this.now());
    const [record, records] = await Promise.all([
      this.repository.getForDate(localUserId, checkInDate),
      this.repository.listForUser(localUserId, 20),
    ]);
    const balances = await checkInBalanceByDate(this.taskRepository, localUserId, records);
    return {
      ok: true,
      status: 200,
      checkIn: publicStatus(checkInDate, record),
      records: publicRecords(records, balances),
    };
  }

  async claim(localUserId: string): Promise<DailyCheckInClaimResult | DailyCheckInFailure> {
    const checkInDate = beijingDate(this.now());
    const existing = await this.repository.getForDate(localUserId, checkInDate);
    if (existing?.status === "credited") {
      return this.claimResponse(checkInDate, existing, "already_checked");
    }

    const mapping = await this.mappingRepository.getByLocalUserId(localUserId);
    if (!mapping || mapping.sync_status !== "active" || !mapping.new_api_user_id) {
      return failure("mapping_pending", 409, "Active New API mapping is required.");
    }
    if (!this.taskRepository.claimQuotaAdjustment || !this.taskRepository.markQuotaAdjustmentApplied || !this.taskRepository.markQuotaAdjustmentFailed) {
      return failure("checkin_unavailable", 503, "Daily check-in quota adjustment is not configured.");
    }

    const operation = async (): Promise<DailyCheckInClaimResult | DailyCheckInFailure> => {
      const record = await this.repository.claimForDate({
        localUserId,
        newApiUserId: mapping.new_api_user_id!,
        checkInDate,
        quotaDelta: DAILY_CHECK_IN_REWARD_CREDITS,
        now: this.now(),
      });
      if (record.status === "credited") return this.claimResponse(checkInDate, record, "already_checked");

      const key = idempotencyKey(localUserId, checkInDate);
      try {
        const currentQuota = await this.getProviderQuota(mapping.new_api_user_id!);
        const targetQuota = currentQuota + DAILY_CHECK_IN_REWARD_CREDITS;
        const adjustment = await this.taskRepository.claimQuotaAdjustment!({
          localUserId,
          newApiUserId: mapping.new_api_user_id!,
          taskId: taskId(checkInDate),
          idempotencyKey: key,
          quotaDelta: DAILY_CHECK_IN_REWARD_CREDITS,
          originalQuota: currentQuota,
          targetQuota,
          now: this.now(),
        });
        const conflicts = adjustmentConflicts(adjustment, {
          localUserId,
          newApiUserId: mapping.new_api_user_id!,
          checkInDate,
        });
        if (conflicts.length) {
          await this.repository.markFailed(record.id, "Daily check-in idempotency key conflict.", this.now()).catch(() => undefined);
          return failure("checkin_conflict", 409, "Daily check-in idempotency key conflict.");
        }
        if (adjustment.status === "applied") {
          const credited = await this.repository.markCredited(record.id, adjustment.provider_adjustment_id || `new-api:${key}`, this.now());
          this.invalidateQuota(localUserId);
          return this.claimResponse(checkInDate, credited, "already_checked");
        }

        const persistedOriginalQuota = adjustment.original_quota ?? currentQuota;
        const persistedTargetQuota = adjustment.target_quota ?? targetQuota;
        if (!adjustment.created && currentQuota === persistedTargetQuota) {
          const applied = await this.taskRepository.markQuotaAdjustmentApplied!(
            key,
            `new-api:${key}:recovered`,
            this.now(),
          );
          const credited = await this.repository.markCredited(record.id, applied.provider_adjustment_id || `new-api:${key}:recovered`, this.now());
          this.invalidateQuota(localUserId);
          return this.claimResponse(checkInDate, credited, "credited");
        }
        if (!adjustment.created && currentQuota !== persistedOriginalQuota) {
          const message = "New API quota changed outside the pending daily check-in adjustment.";
          await this.taskRepository.markQuotaAdjustmentFailed!(key, message, this.now()).catch(() => undefined);
          await this.repository.markFailed(record.id, message, this.now()).catch(() => undefined);
          return failure("checkin_conflict", 409, "Daily check-in requires manual quota reconciliation.");
        }

        await this.setProviderQuota(mapping.new_api_user_id!, persistedTargetQuota);
        const applied = await this.taskRepository.markQuotaAdjustmentApplied!(
          key,
          `new-api:${key}`,
          this.now(),
        );
        const credited = await this.repository.markCredited(record.id, applied.provider_adjustment_id || `new-api:${key}`, this.now());
        this.invalidateQuota(localUserId);
        return this.claimResponse(checkInDate, credited, "credited");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Daily check-in quota adjustment failed.";
        await this.taskRepository.markQuotaAdjustmentFailed!(key, message, this.now()).catch(() => undefined);
        await this.repository.markFailed(record.id, message, this.now()).catch(() => undefined);
        return failure("quota_unavailable", 503, "Daily check-in quota adjustment failed.");
      }
    };

    if (this.taskRepository.withQuotaAdjustmentLock) {
      return this.taskRepository.withQuotaAdjustmentLock(mapping.new_api_user_id, operation);
    }
    return operation();
  }

  private async claimResponse(
    checkInDate: string,
    record: DailyCheckInRecord,
    action: DailyCheckInClaimResult["action"],
  ): Promise<DailyCheckInClaimResult> {
    const records = await this.repository.listForUser(record.local_user_id, 20);
    const balances = await checkInBalanceByDate(this.taskRepository, record.local_user_id, records);
    return {
      ok: true,
      status: 200,
      action,
      quota_delta: action === "credited" ? DAILY_CHECK_IN_REWARD_CREDITS : 0,
      checkIn: publicStatus(checkInDate, record),
      records: publicRecords(records, balances),
    };
  }
}

let defaultDailyCheckInService: DailyCheckInService | null = null;

export function createDailyCheckInService(dependencies?: DailyCheckInServiceDependencies) {
  return new DailyCheckInService(dependencies);
}

export function getDailyCheckInService() {
  defaultDailyCheckInService ||= new DailyCheckInService();
  return defaultDailyCheckInService;
}
