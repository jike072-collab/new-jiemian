import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { dataRoot, readJsonFile, writeJsonFile } from "../paths";

export type DailyCheckInStatus = "pending" | "credited" | "failed";

export type DailyCheckInRecord = {
  id: string;
  local_user_id: string;
  new_api_user_id: string;
  checkin_date: string;
  quota_delta: number;
  status: DailyCheckInStatus;
  provider_adjustment_id: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  claimed_at: string | null;
  version: number;
  created: boolean;
};

export type DailyCheckInClaimInput = {
  localUserId: string;
  newApiUserId: string;
  checkInDate: string;
  quotaDelta: number;
  now?: Date;
};

export type DailyCheckInRepository = {
  getForDate(localUserId: string, checkInDate: string): Promise<DailyCheckInRecord | null>;
  claimForDate(input: DailyCheckInClaimInput): Promise<DailyCheckInRecord>;
  markCredited(recordId: string, providerAdjustmentId: string, now?: Date): Promise<DailyCheckInRecord>;
  markFailed(recordId: string, error: string, now?: Date): Promise<DailyCheckInRecord>;
  listForUser(localUserId: string, limit?: number): Promise<DailyCheckInRecord[]>;
};

type CheckInStorage = {
  read(): Promise<DailyCheckInRecord[]>;
  write(records: DailyCheckInRecord[]): Promise<void>;
};

const defaultCheckInPath = join(dataRoot, "daily-checkins.json");
const MAX_ERROR_MESSAGE_LENGTH = 240;

function nowIso(now?: Date) {
  return (now || new Date()).toISOString();
}

function requiredText(value: string, name: string) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${name} is required.`);
  return normalized;
}

function cloneRecord(record: DailyCheckInRecord): DailyCheckInRecord {
  return { ...record };
}

function persistRecord(record: DailyCheckInRecord): DailyCheckInRecord {
  return { ...record, created: false };
}

function sanitizeError(value: string) {
  return String(value || "Daily check-in failed.")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/Authorization[=:]\s*[^,\s}]+/gi, "Authorization=[REDACTED]")
    .replace(/(token|password|cookie|secret|key)[=:]\s*[^,\s}]+/gi, "$1=[REDACTED]")
    .slice(0, MAX_ERROR_MESSAGE_LENGTH);
}

class StoreDailyCheckInRepository implements DailyCheckInRepository {
  private queue = Promise.resolve();

  constructor(private readonly storage: CheckInStorage) {}

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

  private async mutate<T>(operation: (records: DailyCheckInRecord[]) => Promise<T> | T) {
    return this.withLock(async () => {
      const records = (await this.storage.read()).map(cloneRecord);
      const result = await operation(records);
      await this.storage.write(records.map(persistRecord));
      return result;
    });
  }

  async getForDate(localUserId: string, checkInDate: string) {
    const userId = requiredText(localUserId, "localUserId");
    const date = requiredText(checkInDate, "checkInDate");
    const records = await this.storage.read();
    const found = records.find((record) => record.local_user_id === userId && record.checkin_date === date);
    return found ? cloneRecord(found) : null;
  }

  async claimForDate(input: DailyCheckInClaimInput) {
    const timestamp = nowIso(input.now);
    const localUserId = requiredText(input.localUserId, "localUserId");
    const checkInDate = requiredText(input.checkInDate, "checkInDate");
    return this.mutate((records) => {
      const index = records.findIndex((record) => record.local_user_id === localUserId && record.checkin_date === checkInDate);
      if (index >= 0) {
        const existing = records[index];
        if (existing.status === "failed") {
          records[index] = {
            ...existing,
            new_api_user_id: requiredText(input.newApiUserId, "newApiUserId"),
            quota_delta: input.quotaDelta,
            status: "pending",
            last_error: null,
            updated_at: timestamp,
            version: existing.version + 1,
          };
        }
        return { ...cloneRecord(records[index]), created: false };
      }

      const record: DailyCheckInRecord = {
        id: randomUUID(),
        local_user_id: localUserId,
        new_api_user_id: requiredText(input.newApiUserId, "newApiUserId"),
        checkin_date: checkInDate,
        quota_delta: input.quotaDelta,
        status: "pending",
        provider_adjustment_id: null,
        last_error: null,
        created_at: timestamp,
        updated_at: timestamp,
        claimed_at: null,
        version: 1,
        created: true,
      };
      records.push(persistRecord(record));
      return cloneRecord(record);
    });
  }

  async markCredited(recordId: string, providerAdjustmentId: string, now?: Date) {
    const timestamp = nowIso(now);
    return this.update(recordId, {
      status: "credited",
      provider_adjustment_id: requiredText(providerAdjustmentId, "providerAdjustmentId"),
      last_error: null,
      claimed_at: timestamp,
      updated_at: timestamp,
    });
  }

  async markFailed(recordId: string, error: string, now?: Date) {
    return this.update(recordId, {
      status: "failed",
      last_error: sanitizeError(error),
      updated_at: nowIso(now),
    });
  }

  async listForUser(localUserId: string, limit = 20) {
    const userId = requiredText(localUserId, "localUserId");
    const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)));
    const records = (await this.storage.read())
      .filter((record) => record.local_user_id === userId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, safeLimit);
    return records.map(cloneRecord);
  }

  private async update(recordId: string, patch: Partial<DailyCheckInRecord>) {
    return this.mutate((records) => {
      const index = records.findIndex((record) => record.id === recordId.trim());
      if (index < 0) throw new Error("Daily check-in record was not found.");
      records[index] = {
        ...records[index],
        ...patch,
        version: records[index].version + 1,
      };
      return cloneRecord(records[index]);
    });
  }
}

export function createMemoryDailyCheckInRepository(seed: DailyCheckInRecord[] = []) {
  let records = seed.map(persistRecord);
  return new StoreDailyCheckInRepository({
    async read() {
      return records.map(cloneRecord);
    },
    async write(nextRecords) {
      records = nextRecords.map(persistRecord);
    },
  });
}

export function createJsonDailyCheckInRepository(path = defaultCheckInPath) {
  return new StoreDailyCheckInRepository({
    async read() {
      return readJsonFile<DailyCheckInRecord[]>(path, []);
    },
    async write(records) {
      await writeJsonFile(path, records.map(persistRecord));
    },
  });
}
