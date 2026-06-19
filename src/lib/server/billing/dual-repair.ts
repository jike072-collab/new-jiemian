import { createHash } from "node:crypto";
import { join } from "node:path";

import { redactSecret } from "../integrations/new-api/redaction";
import { dataRoot, readJsonFile, writeJsonFile } from "../paths";

export type BillingDualRepairStatus = "pending" | "repaired" | "failed";

export type BillingDualRepairRecord = {
  id: string;
  scope: string;
  operation: string;
  status: BillingDualRepairStatus;
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

type RecordBillingDualRepairInput = {
  scope: string;
  operation: string;
  key: string | number | null | undefined;
  error: unknown;
  now?: Date;
};

type BillingDualRepairStorage = {
  read(): Promise<BillingDualRepairRecord[]>;
  write(records: BillingDualRepairRecord[]): Promise<void>;
};

const MAX_ERROR_LENGTH = 300;

function defaultRepairStorePath() {
  return process.env.APP_BILLING_DUAL_REPAIR_STORE_PATH || join(dataRoot, "billing-dual-repair-records.json");
}

function nowIso(now?: Date) {
  return (now || new Date()).toISOString();
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function redactedBillingDualRepairKey(value: string | number | null | undefined) {
  void value;
  return "[REDACTED]";
}

function sanitizeErrorCode(error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code || "")
    : "";
  const name = error instanceof Error ? error.name : "";
  return (code || name || "BILLING_DUAL_SHADOW_FAILURE")
    .replace(/[^A-Z0-9_.:-]+/gi, "_")
    .slice(0, 80);
}

export function sanitizeBillingDualRepairError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error || "shadow persistence failed");
  return redactSecret(raw)
    .replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, "postgresql://[REDACTED]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, "[REDACTED_HOST]")
    .replace(/\b[a-z0-9.-]+\.(?:internal|local|localhost|lan|corp|com|net|org|cn)(?::\d+)?\b/gi, "[REDACTED_HOST]")
    .replace(/\b(host|hostname|server|database|db|user|username)=([^\s&]+)/gi, "$1=[REDACTED]")
    .slice(0, MAX_ERROR_LENGTH);
}

function cloneRecord(record: BillingDualRepairRecord): BillingDualRepairRecord {
  return { ...record };
}

function normalizeRecords(value: unknown): BillingDualRepairRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter((record): record is BillingDualRepairRecord => (
    Boolean(record)
    && typeof record === "object"
    && typeof (record as BillingDualRepairRecord).id === "string"
  )).map(cloneRecord);
}

function recordId(scope: string, operation: string, keyHash: string) {
  return sha256(`billing-dual-repair:${scope}:${operation}:${keyHash}`).slice(0, 32);
}

export class StoreBillingDualRepairRepository {
  private queue = Promise.resolve();

  constructor(private readonly storage: BillingDualRepairStorage) {}

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

  async recordFailure(input: RecordBillingDualRepairInput) {
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
        last_error_message: sanitizeBillingDualRepairError(input.error),
      };

      if (existingIndex >= 0) {
        records[existingIndex] = {
          ...records[existingIndex],
          ...patch,
          redacted_key: redactedBillingDualRepairKey(input.key),
        };
      } else {
        records.push({
          id,
          scope: input.scope,
          operation: input.operation,
          key_hash: keyHash,
          redacted_key: redactedBillingDualRepairKey(input.key),
          source: "json-primary",
          created_at: timestamp,
          ...patch,
        });
      }

      await this.storage.write(records);
      return cloneRecord(records.find((record) => record.id === id)!);
    });
  }

  async list(status?: BillingDualRepairStatus) {
    const records = normalizeRecords(await this.storage.read());
    return (status ? records.filter((record) => record.status === status) : records).map(cloneRecord);
  }
}

export function createJsonBillingDualRepairRepository(path = defaultRepairStorePath()) {
  return new StoreBillingDualRepairRepository({
    async read() {
      return normalizeRecords(await readJsonFile<unknown>(path, []));
    },
    async write(records) {
      await writeJsonFile(path, records);
    },
  });
}

const repairRepositoryCache = new Map<string, StoreBillingDualRepairRepository>();

export function getJsonBillingDualRepairRepository(path = defaultRepairStorePath()) {
  const existing = repairRepositoryCache.get(path);
  if (existing) return existing;
  const repository = createJsonBillingDualRepairRepository(path);
  repairRepositoryCache.set(path, repository);
  return repository;
}
