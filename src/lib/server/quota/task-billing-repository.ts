import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { dataRoot, readJsonFile, writeJsonFile } from "../paths";
import { type TaskBillingRecord, type TaskBillingState } from "./task-billing-types";

type TaskBillingStorage = {
  read(): Promise<TaskBillingRecord[]>;
  write(records: TaskBillingRecord[]): Promise<void>;
};

export type CreateTaskBillingRecordInput = {
  localUserId: string;
  taskId: string;
  usageRecordId?: string | null;
  idempotencyKey: string;
  estimatedQuotaUnits: number;
  now?: Date;
};

export type TaskBillingRecordPatch = {
  new_api_task_id?: string | null;
  usage_record_id?: string | null;
  billing_state?: TaskBillingState;
  final_quota_units?: number | null;
  updated_at?: string;
  settled_at?: string | null;
  refunded_at?: string | null;
  last_error?: string | null;
};

export type TaskBillingRecordListFilter = {
  localUserId?: string;
  states?: TaskBillingState[];
  taskId?: string;
  page?: number;
  pageSize?: number;
};

export type TaskBillingRecordListPage = {
  records: TaskBillingRecord[];
  total: number;
};

export type TaskQuotaAdjustmentStatus = "pending" | "applied" | "failed";

export type TaskQuotaAdjustment = {
  id: string;
  local_user_id: string;
  new_api_user_id: string;
  task_billing_record_id: string | null;
  task_id: string;
  idempotency_key: string;
  quota_delta: number;
  original_quota: number | null;
  target_quota: number | null;
  status: TaskQuotaAdjustmentStatus;
  provider_adjustment_id: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  applied_at: string | null;
  version: number;
  created: boolean;
};

export type TaskQuotaAdjustmentInput = {
  localUserId: string;
  newApiUserId: string;
  taskBillingRecordId?: string | null;
  taskId: string;
  idempotencyKey: string;
  quotaDelta: number;
  originalQuota?: number | null;
  targetQuota?: number | null;
  now?: Date;
};

export type TaskBillingRepository = {
  getByTaskId(localUserId: string, taskId: string): Promise<TaskBillingRecord | null>;
  getByIdempotencyKey(localUserId: string, idempotencyKey: string): Promise<TaskBillingRecord | null>;
  listRecordsPage?(filter?: TaskBillingRecordListFilter): Promise<TaskBillingRecordListPage>;
  createPrecheck(input: CreateTaskBillingRecordInput): Promise<TaskBillingRecord>;
  update(recordId: string, patch: TaskBillingRecordPatch, expectedVersion?: number): Promise<TaskBillingRecord>;
  withQuotaAdjustmentLock?<T>(newApiUserId: string, operation: () => Promise<T>): Promise<T>;
  claimQuotaAdjustment?(input: TaskQuotaAdjustmentInput): Promise<TaskQuotaAdjustment>;
  markQuotaAdjustmentApplied?(idempotencyKey: string, providerAdjustmentId: string, now?: Date): Promise<TaskQuotaAdjustment>;
  markQuotaAdjustmentFailed?(idempotencyKey: string, error: string, now?: Date): Promise<TaskQuotaAdjustment>;
};

export class TaskBillingRepositoryError extends Error {
  constructor(readonly code: "TASK_BILLING_DUPLICATE" | "TASK_BILLING_NOT_FOUND" | "TASK_BILLING_VERSION_CONFLICT", message: string) {
    super(message);
    this.name = "TaskBillingRepositoryError";
  }
}

const defaultTaskBillingPath = join(dataRoot, "task-billing-records.json");
const defaultTaskQuotaAdjustmentPath = join(dataRoot, "task-quota-adjustments.json");

function nowIso(now?: Date) {
  return (now || new Date()).toISOString();
}

function requiredText(value: string, name: string) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${name} is required.`);
  return normalized;
}

function cloneRecord(record: TaskBillingRecord): TaskBillingRecord {
  return { ...record };
}

function cloneAdjustment(adjustment: TaskQuotaAdjustment): TaskQuotaAdjustment {
  return { ...adjustment };
}

function persistAdjustment(adjustment: TaskQuotaAdjustment): TaskQuotaAdjustment {
  return { ...adjustment, created: false };
}

function normalizeRecord(record: Partial<TaskBillingRecord>): TaskBillingRecord {
  const timestamp = record.created_at || nowIso();
  return {
    id: record.id || randomUUID(),
    local_user_id: String(record.local_user_id || ""),
    task_id: String(record.task_id || ""),
    new_api_task_id: record.new_api_task_id ?? null,
    usage_record_id: record.usage_record_id ?? null,
    idempotency_key: String(record.idempotency_key || ""),
    billing_state: record.billing_state || "prechecked",
    estimated_quota_units: Number(record.estimated_quota_units || 0),
    final_quota_units: record.final_quota_units === undefined ? null : record.final_quota_units,
    created_at: timestamp,
    updated_at: record.updated_at || timestamp,
    settled_at: record.settled_at ?? null,
    refunded_at: record.refunded_at ?? null,
    last_error: record.last_error ?? null,
    version: Number(record.version || 1),
  };
}

function normalizeAdjustment(adjustment: Partial<TaskQuotaAdjustment>): TaskQuotaAdjustment {
  const timestamp = adjustment.created_at || nowIso();
  return {
    id: adjustment.id || randomUUID(),
    local_user_id: String(adjustment.local_user_id || ""),
    new_api_user_id: String(adjustment.new_api_user_id || ""),
    task_billing_record_id: adjustment.task_billing_record_id ?? null,
    task_id: String(adjustment.task_id || ""),
    idempotency_key: String(adjustment.idempotency_key || ""),
    quota_delta: Number(adjustment.quota_delta || 0),
    original_quota: adjustment.original_quota === undefined ? null : adjustment.original_quota,
    target_quota: adjustment.target_quota === undefined ? null : adjustment.target_quota,
    status: adjustment.status || "pending",
    provider_adjustment_id: adjustment.provider_adjustment_id ?? null,
    last_error: adjustment.last_error ?? null,
    created_at: timestamp,
    updated_at: adjustment.updated_at || timestamp,
    applied_at: adjustment.applied_at ?? null,
    version: Number(adjustment.version || 1),
    created: false,
  };
}

class StoreTaskBillingRepository implements TaskBillingRepository {
  private queue = Promise.resolve();
  private readonly quotaAdjustmentLocks = new Map<string, Promise<void>>();

  constructor(
    private readonly storage: TaskBillingStorage,
    private readonly adjustmentStorage?: {
      read(): Promise<TaskQuotaAdjustment[]>;
      write(adjustments: TaskQuotaAdjustment[]): Promise<void>;
    },
  ) {}

  private async withLock<T>(operation: () => Promise<T>) {
    const previous = this.queue;
    let release: () => void = () => undefined;
    this.queue = previous.then(() => new Promise<void>((resolve) => {
      release = resolve;
    }));
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private async mutate<T>(operation: (records: TaskBillingRecord[]) => Promise<T> | T) {
    return this.withLock(async () => {
      const records = (await this.storage.read()).map(cloneRecord);
      const result = await operation(records);
      await this.storage.write(records);
      return result;
    });
  }

  async getByTaskId(localUserId: string, taskId: string) {
    const records = await this.storage.read();
    const found = records.find((record) => (
      record.local_user_id === localUserId.trim()
      && record.task_id === taskId.trim()
    ));
    return found ? cloneRecord(found) : null;
  }

  async getByIdempotencyKey(localUserId: string, idempotencyKey: string) {
    const records = await this.storage.read();
    const found = records.find((record) => (
      record.local_user_id === localUserId.trim()
      && record.idempotency_key === idempotencyKey.trim()
    ));
    return found ? cloneRecord(found) : null;
  }

  async listRecordsPage(filter: TaskBillingRecordListFilter = {}) {
    const page = Math.max(1, Math.trunc(filter.page || 1));
    const pageSize = Math.min(100, Math.max(1, Math.trunc(filter.pageSize || 20)));
    const states = filter.states?.length ? new Set(filter.states) : null;
    const localUserId = filter.localUserId?.trim();
    const taskId = filter.taskId?.trim();
    const records = (await this.storage.read())
      .filter((record) => !localUserId || record.local_user_id === localUserId)
      .filter((record) => !taskId || record.task_id === taskId)
      .filter((record) => !states || states.has(record.billing_state))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .map(cloneRecord);
    const start = (page - 1) * pageSize;
    return {
      records: records.slice(start, start + pageSize),
      total: records.length,
    };
  }

  async createPrecheck(input: CreateTaskBillingRecordInput) {
    const timestamp = nowIso(input.now);
    const localUserId = requiredText(input.localUserId, "localUserId");
    const taskId = requiredText(input.taskId, "taskId");
    const idempotencyKey = requiredText(input.idempotencyKey, "idempotencyKey");
    return this.mutate((records) => {
      const duplicate = records.find((record) => (
        (record.local_user_id === localUserId && record.task_id === taskId)
        || (record.local_user_id === localUserId && record.idempotency_key === idempotencyKey)
      ));
      if (duplicate) {
        throw new TaskBillingRepositoryError("TASK_BILLING_DUPLICATE", "Task billing record already exists.");
      }
      const record: TaskBillingRecord = {
        id: randomUUID(),
        local_user_id: localUserId,
        task_id: taskId,
        new_api_task_id: null,
        usage_record_id: input.usageRecordId || null,
        idempotency_key: idempotencyKey,
        billing_state: "prechecked",
        estimated_quota_units: input.estimatedQuotaUnits,
        final_quota_units: null,
        created_at: timestamp,
        updated_at: timestamp,
        settled_at: null,
        refunded_at: null,
        last_error: null,
        version: 1,
      };
      records.push(record);
      return cloneRecord(record);
    });
  }

  async update(recordId: string, patch: TaskBillingRecordPatch, expectedVersion?: number) {
    return this.mutate((records) => {
      const index = records.findIndex((record) => record.id === recordId.trim());
      if (index < 0) {
        throw new TaskBillingRepositoryError("TASK_BILLING_NOT_FOUND", "Task billing record was not found.");
      }
      if (expectedVersion !== undefined && records[index].version !== expectedVersion) {
        throw new TaskBillingRepositoryError("TASK_BILLING_VERSION_CONFLICT", "Task billing record changed before update.");
      }
      records[index] = {
        ...records[index],
        ...patch,
        version: records[index].version + 1,
      };
      return cloneRecord(records[index]);
    });
  }

  async withQuotaAdjustmentLock<T>(newApiUserId: string, operation: () => Promise<T>) {
    const key = newApiUserId.trim();
    const previous = this.quotaAdjustmentLocks.get(key) || Promise.resolve();
    let release: () => void = () => undefined;
    const current = previous.then(() => new Promise<void>((resolve) => {
      release = resolve;
    }));
    this.quotaAdjustmentLocks.set(key, current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.quotaAdjustmentLocks.get(key) === current) this.quotaAdjustmentLocks.delete(key);
    }
  }

  async claimQuotaAdjustment(input: TaskQuotaAdjustmentInput) {
    if (!this.adjustmentStorage) throw new Error("Task quota adjustment storage is not configured.");
    const timestamp = nowIso(input.now);
    const idempotencyKey = requiredText(input.idempotencyKey, "idempotencyKey");
    return this.withLock(async () => {
      const adjustments = (await this.adjustmentStorage!.read()).map(cloneAdjustment);
      const existing = adjustments.find((adjustment) => adjustment.idempotency_key === idempotencyKey);
      if (existing) return { ...cloneAdjustment(existing), created: false };
      const adjustment: TaskQuotaAdjustment = {
        id: randomUUID(),
        local_user_id: requiredText(input.localUserId, "localUserId"),
        new_api_user_id: requiredText(input.newApiUserId, "newApiUserId"),
        task_billing_record_id: input.taskBillingRecordId || null,
        task_id: requiredText(input.taskId, "taskId"),
        idempotency_key: idempotencyKey,
        quota_delta: input.quotaDelta,
        original_quota: input.originalQuota ?? null,
        target_quota: input.targetQuota ?? null,
        status: "pending",
        provider_adjustment_id: null,
        last_error: null,
        created_at: timestamp,
        updated_at: timestamp,
        applied_at: null,
        version: 1,
        created: true,
      };
      adjustments.push(persistAdjustment(adjustment));
      await this.adjustmentStorage!.write(adjustments);
      return { ...cloneAdjustment(adjustment), created: true };
    });
  }

  async markQuotaAdjustmentApplied(idempotencyKey: string, providerAdjustmentId: string, now?: Date) {
    if (!this.adjustmentStorage) throw new Error("Task quota adjustment storage is not configured.");
    return this.updateAdjustment(idempotencyKey, {
      status: "applied",
      provider_adjustment_id: providerAdjustmentId,
      last_error: null,
      applied_at: nowIso(now),
      updated_at: nowIso(now),
    });
  }

  async markQuotaAdjustmentFailed(idempotencyKey: string, error: string, now?: Date) {
    if (!this.adjustmentStorage) throw new Error("Task quota adjustment storage is not configured.");
    return this.updateAdjustment(idempotencyKey, {
      status: "failed",
      last_error: error,
      updated_at: nowIso(now),
    });
  }

  private async updateAdjustment(idempotencyKey: string, patch: Partial<TaskQuotaAdjustment>) {
    return this.withLock(async () => {
      const adjustments = (await this.adjustmentStorage!.read()).map(cloneAdjustment);
      const index = adjustments.findIndex((adjustment) => adjustment.idempotency_key === idempotencyKey.trim());
      if (index < 0) throw new TaskBillingRepositoryError("TASK_BILLING_NOT_FOUND", "Task quota adjustment was not found.");
      adjustments[index] = {
        ...adjustments[index],
        ...patch,
        version: adjustments[index].version + 1,
      };
      await this.adjustmentStorage!.write(adjustments);
      return cloneAdjustment(adjustments[index]);
    });
  }
}

export function createMemoryTaskBillingRepository(seed: TaskBillingRecord[] = []) {
  let records = seed.map(normalizeRecord);
  let adjustments: TaskQuotaAdjustment[] = [];
  return new StoreTaskBillingRepository({
    async read() {
      return records.map(cloneRecord);
    },
    async write(nextRecords) {
      records = nextRecords.map(cloneRecord);
    },
  }, {
    async read() {
      return adjustments.map(cloneAdjustment);
    },
    async write(nextAdjustments) {
      adjustments = nextAdjustments.map(cloneAdjustment);
    },
  });
}

export function createJsonTaskBillingRepository(
  path = defaultTaskBillingPath,
  adjustmentPath = defaultTaskQuotaAdjustmentPath,
) {
  return new StoreTaskBillingRepository({
    async read() {
      return readJsonFile<Partial<TaskBillingRecord>[]>(path, []).then((records) => records.map(normalizeRecord));
    },
    async write(records) {
      await writeJsonFile(path, records);
    },
  }, {
    async read() {
      return readJsonFile<Partial<TaskQuotaAdjustment>[]>(adjustmentPath, [])
        .then((adjustments) => adjustments.map(normalizeAdjustment));
    },
    async write(adjustments) {
      await writeJsonFile(adjustmentPath, adjustments);
    },
  });
}
