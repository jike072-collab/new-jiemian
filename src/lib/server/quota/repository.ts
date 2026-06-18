import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { dataRoot, readJsonFile, writeJsonFile } from "../paths";
import { type BillableOperation, type UsageLogEntry, type UsagePage, type UsageStatus } from "./types";

type UsageStorage = {
  read(): Promise<UsageLogEntry[]>;
  write(entries: UsageLogEntry[]): Promise<void>;
};

export type RecordUsageInput = {
  localUserId: string;
  newApiUserId?: string | null;
  taskId: string;
  operation: BillableOperation;
  status: UsageStatus;
  estimatedQuotaUnits: number;
  actualQuotaUnits?: number | null;
  upstreamLogId?: string | null;
  upstreamRequestId?: string | null;
  upstreamModel?: string | null;
  upstreamCreatedAt?: string | null;
  idempotencyKey: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  now?: Date;
};

export type UsageLogRepository = {
  record(input: RecordUsageInput): Promise<UsageLogEntry>;
  listForUser(localUserId: string, page?: number, pageSize?: number): Promise<UsagePage>;
  getByTaskId(localUserId: string, taskId: string): Promise<UsageLogEntry | null>;
};

const defaultUsagePath = join(dataRoot, "quota-usage-log.json");
const MAX_ERROR_MESSAGE_LENGTH = 240;

function requiredText(value: string, name: string) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${name} is required.`);
  return normalized;
}

function nowIso(now?: Date) {
  return (now || new Date()).toISOString();
}

function cloneEntry(entry: UsageLogEntry): UsageLogEntry {
  return { ...entry };
}

function sanitizeError(value?: string | null) {
  if (!value) return null;
  return String(value)
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/Authorization[=:]\s*[^,\s}]+/gi, "Authorization=[REDACTED]")
    .replace(/(token|password|cookie|secret|key)[=:]\s*[^,\s}]+/gi, "$1=[REDACTED]")
    .slice(0, MAX_ERROR_MESSAGE_LENGTH);
}

class StoreUsageLogRepository implements UsageLogRepository {
  private queue = Promise.resolve();

  constructor(private readonly storage: UsageStorage) {}

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

  private async mutate<T>(operation: (entries: UsageLogEntry[]) => Promise<T> | T) {
    return this.withLock(async () => {
      const entries = (await this.storage.read()).map(cloneEntry);
      const result = await operation(entries);
      await this.storage.write(entries);
      return result;
    });
  }

  async record(input: RecordUsageInput) {
    const timestamp = nowIso(input.now);
    const localUserId = requiredText(input.localUserId, "localUserId");
    const taskId = requiredText(input.taskId, "taskId");
    const idempotencyKey = requiredText(input.idempotencyKey, "idempotencyKey");
    return this.mutate((entries) => {
      const existingIndex = entries.findIndex((entry) => entry.idempotency_key === idempotencyKey);
      const patch = {
        local_user_id: localUserId,
        new_api_user_id: input.newApiUserId === undefined ? null : input.newApiUserId,
        task_id: taskId,
        operation: input.operation,
        status: input.status,
        estimated_quota_units: input.estimatedQuotaUnits,
        actual_quota_units: input.actualQuotaUnits === undefined ? null : input.actualQuotaUnits,
        upstream_log_id: input.upstreamLogId || null,
        upstream_request_id: input.upstreamRequestId || null,
        upstream_model: input.upstreamModel || null,
        upstream_created_at: input.upstreamCreatedAt || null,
        updated_at: timestamp,
        error_code: input.errorCode || null,
        error_message: sanitizeError(input.errorMessage),
      };

      if (existingIndex >= 0) {
        entries[existingIndex] = {
          ...entries[existingIndex],
          ...patch,
          id: entries[existingIndex].id,
          created_at: entries[existingIndex].created_at,
          idempotency_key: entries[existingIndex].idempotency_key,
        };
        return cloneEntry(entries[existingIndex]);
      }

      const entry: UsageLogEntry = {
        id: randomUUID(),
        ...patch,
        created_at: timestamp,
        idempotency_key: idempotencyKey,
      };
      entries.push(entry);
      return cloneEntry(entry);
    });
  }

  async listForUser(localUserId: string, page = 1, pageSize = 20) {
    const safePage = Math.max(1, Math.floor(page));
    const safePageSize = Math.min(100, Math.max(1, Math.floor(pageSize)));
    const entries = (await this.storage.read())
      .filter((entry) => entry.local_user_id === localUserId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    const start = (safePage - 1) * safePageSize;
    return {
      entries: entries.slice(start, start + safePageSize).map(cloneEntry),
      page: safePage,
      pageSize: safePageSize,
      total: entries.length,
    };
  }

  async getByTaskId(localUserId: string, taskId: string) {
    const entries = await this.storage.read();
    const found = entries.find((entry) => entry.local_user_id === localUserId && entry.task_id === taskId);
    return found ? cloneEntry(found) : null;
  }
}

export function createMemoryUsageLogRepository(seed: UsageLogEntry[] = []) {
  let entries = seed.map(cloneEntry);
  return new StoreUsageLogRepository({
    async read() {
      return entries.map(cloneEntry);
    },
    async write(nextEntries) {
      entries = nextEntries.map(cloneEntry);
    },
  });
}

export function createJsonUsageLogRepository(path = defaultUsagePath) {
  return new StoreUsageLogRepository({
    async read() {
      return readJsonFile<UsageLogEntry[]>(path, []);
    },
    async write(entries) {
      await writeJsonFile(path, entries);
    },
  });
}
