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

export type TaskBillingRepository = {
  getByTaskId(localUserId: string, taskId: string): Promise<TaskBillingRecord | null>;
  getByIdempotencyKey(localUserId: string, idempotencyKey: string): Promise<TaskBillingRecord | null>;
  createPrecheck(input: CreateTaskBillingRecordInput): Promise<TaskBillingRecord>;
  update(recordId: string, patch: TaskBillingRecordPatch, expectedVersion?: number): Promise<TaskBillingRecord>;
};

export class TaskBillingRepositoryError extends Error {
  constructor(readonly code: "TASK_BILLING_DUPLICATE" | "TASK_BILLING_NOT_FOUND" | "TASK_BILLING_VERSION_CONFLICT", message: string) {
    super(message);
    this.name = "TaskBillingRepositoryError";
  }
}

const defaultTaskBillingPath = join(dataRoot, "task-billing-records.json");

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

class StoreTaskBillingRepository implements TaskBillingRepository {
  private queue = Promise.resolve();

  constructor(private readonly storage: TaskBillingStorage) {}

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
}

export function createMemoryTaskBillingRepository(seed: TaskBillingRecord[] = []) {
  let records = seed.map(normalizeRecord);
  return new StoreTaskBillingRepository({
    async read() {
      return records.map(cloneRecord);
    },
    async write(nextRecords) {
      records = nextRecords.map(cloneRecord);
    },
  });
}

export function createJsonTaskBillingRepository(path = defaultTaskBillingPath) {
  return new StoreTaskBillingRepository({
    async read() {
      return readJsonFile<Partial<TaskBillingRecord>[]>(path, []).then((records) => records.map(normalizeRecord));
    },
    async write(records) {
      await writeJsonFile(path, records);
    },
  });
}
