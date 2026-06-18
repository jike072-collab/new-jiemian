import { createHash } from "node:crypto";
import { join } from "node:path";

import { redactSecret } from "../integrations/new-api/redaction";
import { dataRoot, readJsonFile, writeJsonFile } from "../paths";

export type AuthDualRepairStatus = "pending" | "repaired" | "failed";

export type AuthDualRepairRecord = {
  id: string;
  scope: string;
  operation: string;
  status: AuthDualRepairStatus;
  key_hash: string;
  redacted_key: string;
  source: "json-primary";
  created_at: string;
  updated_at: string;
  last_attempt_at: string | null;
  retry_count: number;
  last_error_code: string | null;
  last_error_message: string | null;
};

export type RecordAuthDualRepairInput = {
  scope: string;
  operation: string;
  key: string | number | null | undefined;
  error: unknown;
  now?: Date;
};

export type AuthDualRepairRepository = {
  recordFailure(input: RecordAuthDualRepairInput): Promise<AuthDualRepairRecord>;
  list(status?: AuthDualRepairStatus): Promise<AuthDualRepairRecord[]>;
  markRepaired(id: string, now?: Date): Promise<AuthDualRepairRecord | null>;
  markFailed(id: string, error: unknown, now?: Date): Promise<AuthDualRepairRecord | null>;
};

type RepairStorage = {
  read(): Promise<AuthDualRepairRecord[]>;
  write(records: AuthDualRepairRecord[]): Promise<void>;
};

const MAX_ERROR_LENGTH = 300;

function defaultRepairStorePath() {
  return process.env.APP_AUTH_DUAL_REPAIR_STORE_PATH || join(dataRoot, "auth-dual-repair-records.json");
}

function nowIso(now?: Date) {
  return (now || new Date()).toISOString();
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function redactedAuthDualRepairKey(value: string | number | null | undefined) {
  void value;
  return "[REDACTED]";
}

function sanitizeErrorCode(error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code || "")
    : "";
  const name = error instanceof Error ? error.name : "";
  return (code || name || "AUTH_DUAL_SHADOW_FAILURE")
    .replace(/[^A-Z0-9_.:-]+/gi, "_")
    .slice(0, 80);
}

export function sanitizeAuthDualRepairError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error || "shadow persistence failed");
  return redactSecret(raw)
    .replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, "postgresql://[REDACTED]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, "[REDACTED_HOST]")
    .replace(/\b[a-z0-9.-]+\.(?:internal|local|localhost|lan|corp|com|net|org|cn)(?::\d+)?\b/gi, "[REDACTED_HOST]")
    .replace(/\b(host|hostname|server|database|db|user|username)=([^\s&]+)/gi, "$1=[REDACTED]")
    .slice(0, MAX_ERROR_LENGTH);
}

function cloneRecord(record: AuthDualRepairRecord): AuthDualRepairRecord {
  return { ...record };
}

function normalizeRecords(value: unknown): AuthDualRepairRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter((record): record is AuthDualRepairRecord => (
    Boolean(record)
    && typeof record === "object"
    && typeof (record as AuthDualRepairRecord).id === "string"
  )).map(cloneRecord);
}

function recordId(scope: string, operation: string, keyHash: string) {
  return sha256(`auth-dual-repair:${scope}:${operation}:${keyHash}`).slice(0, 32);
}

export class StoreAuthDualRepairRepository implements AuthDualRepairRepository {
  private queue = Promise.resolve();

  constructor(private readonly storage: RepairStorage) {}

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

  async recordFailure(input: RecordAuthDualRepairInput) {
    return this.withLock(async () => {
      const records = normalizeRecords(await this.storage.read());
      const timestamp = nowIso(input.now);
      const keyHash = sha256(String(input.key || ""));
      const id = recordId(input.scope, input.operation, keyHash);
      const existingIndex = records.findIndex((record) => record.id === id);
      const patch = {
        status: "pending" as const,
        updated_at: timestamp,
        last_attempt_at: timestamp,
        retry_count: existingIndex >= 0 ? records[existingIndex].retry_count + 1 : 1,
        last_error_code: sanitizeErrorCode(input.error),
        last_error_message: sanitizeAuthDualRepairError(input.error),
      };

      if (existingIndex >= 0) {
        records[existingIndex] = {
          ...records[existingIndex],
          ...patch,
          redacted_key: redactedAuthDualRepairKey(input.key),
        };
      } else {
        records.push({
          id,
          scope: input.scope,
          operation: input.operation,
          key_hash: keyHash,
          redacted_key: redactedAuthDualRepairKey(input.key),
          source: "json-primary",
          created_at: timestamp,
          ...patch,
        });
      }

      await this.storage.write(records);
      return cloneRecord(records.find((record) => record.id === id)!);
    });
  }

  async list(status?: AuthDualRepairStatus) {
    const records = normalizeRecords(await this.storage.read());
    return (status ? records.filter((record) => record.status === status) : records).map(cloneRecord);
  }

  async markRepaired(id: string, now?: Date) {
    return this.updateStatus(id, {
      status: "repaired",
      last_error_code: null,
      last_error_message: null,
    }, now);
  }

  async markFailed(id: string, error: unknown, now?: Date) {
    return this.updateStatus(id, {
      status: "failed",
      last_error_code: sanitizeErrorCode(error),
      last_error_message: sanitizeAuthDualRepairError(error),
    }, now, true);
  }

  private async updateStatus(
    id: string,
    patch: Pick<AuthDualRepairRecord, "status" | "last_error_code" | "last_error_message">,
    now?: Date,
    incrementRetry = false,
  ) {
    return this.withLock(async () => {
      const records = normalizeRecords(await this.storage.read());
      const index = records.findIndex((record) => record.id === id);
      if (index < 0) return null;
      const timestamp = nowIso(now);
      records[index] = {
        ...records[index],
        ...patch,
        updated_at: timestamp,
        last_attempt_at: timestamp,
        retry_count: records[index].retry_count + (incrementRetry ? 1 : 0),
      };
      await this.storage.write(records);
      return cloneRecord(records[index]);
    });
  }
}

export function createJsonAuthDualRepairRepository(path = defaultRepairStorePath()): AuthDualRepairRepository {
  return new StoreAuthDualRepairRepository({
    async read() {
      return normalizeRecords(await readJsonFile<unknown>(path, []));
    },
    async write(records) {
      await writeJsonFile(path, records);
    },
  });
}

const repairRepositoryCache = new Map<string, AuthDualRepairRepository>();

export function getJsonAuthDualRepairRepository(path = defaultRepairStorePath()) {
  const existing = repairRepositoryCache.get(path);
  if (existing) return existing;
  const repository = createJsonAuthDualRepairRepository(path);
  repairRepositoryCache.set(path, repository);
  return repository;
}
