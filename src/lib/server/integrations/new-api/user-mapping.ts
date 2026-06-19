import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { dataRoot, readJsonFile, writeJsonFile } from "../../paths";
import { redactSecret } from "./redaction";

export type NewApiUserMappingStatus =
  | "pending"
  | "active"
  | "failed"
  | "disabled"
  | "orphaned"
  | "repair_required";

export type NewApiUserMapping = {
  local_user_id: string;
  new_api_user_id: string | null;
  sync_status: NewApiUserMappingStatus;
  created_at: string;
  updated_at: string;
  last_sync_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  retry_count: number;
  version: number;
  idempotency_key: string;
};

export type NewApiUserMappingCreateInput = {
  localUserId: string;
  idempotencyKey?: string;
  now?: Date;
};

export type NewApiUserMappingFailureInput = {
  localUserId: string;
  code: string;
  message: string;
  retryable: boolean;
  maxRetryCount?: number;
  expectedVersion?: number;
  now?: Date;
};

export type NewApiUserMappingTransitionInput = {
  localUserId: string;
  newApiUserId?: string | number | null;
  code?: string;
  message?: string;
  expectedVersion?: number;
  now?: Date;
};

export type NewApiUserMappingPrepareRetryInput = {
  localUserId: string;
  maxRetryCount?: number;
  expectedVersion?: number;
  allowRepairRequired?: boolean;
  now?: Date;
};

export type NewApiUserMappingRepository = {
  getByLocalUserId(localUserId: string): Promise<NewApiUserMapping | null>;
  getByNewApiUserId(newApiUserId: string | number): Promise<NewApiUserMapping | null>;
  listByStatus(status: NewApiUserMappingStatus): Promise<NewApiUserMapping[]>;
  listMappingsPage?(filter?: NewApiUserMappingListFilter): Promise<NewApiUserMappingListPage>;
  createPending(input: NewApiUserMappingCreateInput): Promise<NewApiUserMapping>;
  markActive(input: NewApiUserMappingTransitionInput & { newApiUserId: string | number }): Promise<NewApiUserMapping>;
  markFailed(input: NewApiUserMappingFailureInput): Promise<NewApiUserMapping>;
  markDisabled(input: NewApiUserMappingTransitionInput): Promise<NewApiUserMapping>;
  markOrphaned(input: NewApiUserMappingTransitionInput): Promise<NewApiUserMapping>;
  scheduleRepair(input: NewApiUserMappingTransitionInput): Promise<NewApiUserMapping>;
  prepareRetry(input: NewApiUserMappingPrepareRetryInput): Promise<NewApiUserMapping>;
};

export type NewApiUserMappingListFilter = {
  status?: NewApiUserMappingStatus;
  localUserId?: string;
  page?: number;
  pageSize?: number;
};

export type NewApiUserMappingListPage = {
  mappings: NewApiUserMapping[];
  total: number;
};

export type NewApiUserMappingErrorCode =
  | "NEW_API_MAPPING_CONFLICT"
  | "NEW_API_MAPPING_NOT_FOUND"
  | "NEW_API_MAPPING_VERSION_CONFLICT"
  | "NEW_API_MAPPING_RETRY_EXHAUSTED"
  | "NEW_API_MAPPING_INVALID_INPUT";

export class NewApiUserMappingError extends Error {
  readonly code: NewApiUserMappingErrorCode;
  readonly retryable: boolean;
  readonly safeDetails?: Record<string, string | number | boolean | null>;

  constructor(input: {
    code: NewApiUserMappingErrorCode;
    message: string;
    retryable?: boolean;
    safeDetails?: Record<string, string | number | boolean | null>;
  }) {
    super(input.message);
    this.name = "NewApiUserMappingError";
    this.code = input.code;
    this.retryable = input.retryable ?? false;
    this.safeDetails = input.safeDetails;
  }
}

type MappingStorage = {
  read(): Promise<NewApiUserMapping[]>;
  write(records: NewApiUserMapping[]): Promise<void>;
};

const DEFAULT_MAX_RETRY_COUNT = 3;
const MAX_ERROR_MESSAGE_LENGTH = 300;
const defaultMappingPath = join(dataRoot, "new-api-user-mappings.json");

function nowIso(now?: Date) {
  return (now || new Date()).toISOString();
}

function normalizeLocalUserId(localUserId: string) {
  const normalized = localUserId.trim();
  if (!normalized) {
    throw new NewApiUserMappingError({
      code: "NEW_API_MAPPING_INVALID_INPUT",
      message: "local_user_id is required.",
    });
  }
  return normalized;
}

function normalizeNewApiUserId(newApiUserId: string | number) {
  const normalized = String(newApiUserId).trim();
  if (!normalized) {
    throw new NewApiUserMappingError({
      code: "NEW_API_MAPPING_INVALID_INPUT",
      message: "new_api_user_id is required.",
    });
  }
  return normalized;
}

function cloneMapping(mapping: NewApiUserMapping): NewApiUserMapping {
  return { ...mapping };
}

function cloneRecords(records: NewApiUserMapping[]) {
  return records.map(cloneMapping);
}

function sanitizeErrorMessage(message: string) {
  return redactSecret(String(message || "sync failed")).slice(0, MAX_ERROR_MESSAGE_LENGTH);
}

function sanitizeErrorCode(code: string) {
  return String(code || "UNKNOWN").replace(/[^A-Z0-9_.:-]+/gi, "_").slice(0, 80);
}

function assertExpectedVersion(mapping: NewApiUserMapping, expectedVersion?: number) {
  if (expectedVersion === undefined) return;
  if (mapping.version !== expectedVersion) {
    throw new NewApiUserMappingError({
      code: "NEW_API_MAPPING_VERSION_CONFLICT",
      message: "Mapping version changed before the requested transition.",
      retryable: true,
      safeDetails: {
        local_user_id: mapping.local_user_id,
        expected_version: expectedVersion,
        actual_version: mapping.version,
      },
    });
  }
}

function assertUniqueNewApiUserId(
  records: NewApiUserMapping[],
  localUserId: string,
  newApiUserId: string,
) {
  const conflicting = records.find((record) => (
    record.local_user_id !== localUserId
    && record.new_api_user_id === newApiUserId
    && record.sync_status !== "orphaned"
  ));
  if (!conflicting) return;
  throw new NewApiUserMappingError({
    code: "NEW_API_MAPPING_CONFLICT",
    message: "New API user is already mapped to another local user.",
    safeDetails: {
      local_user_id: localUserId,
      conflicting_local_user_id: conflicting.local_user_id,
      new_api_user_id: newApiUserId,
    },
  });
}

function nextMapping(
  mapping: NewApiUserMapping,
  patch: Partial<NewApiUserMapping>,
  now?: Date,
) {
  return {
    ...mapping,
    ...patch,
    updated_at: nowIso(now),
    version: mapping.version + 1,
  };
}

class NewApiUserMappingStoreRepository implements NewApiUserMappingRepository {
  private queue = Promise.resolve();

  constructor(private readonly storage: MappingStorage) {}

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

  private async mutate<T>(operation: (records: NewApiUserMapping[]) => Promise<T> | T) {
    return this.withLock(async () => {
      const records = cloneRecords(await this.storage.read());
      const result = await operation(records);
      await this.storage.write(records);
      return result;
    });
  }

  async getByLocalUserId(localUserId: string) {
    const normalized = normalizeLocalUserId(localUserId);
    const records = await this.storage.read();
    const found = records.find((record) => record.local_user_id === normalized);
    return found ? cloneMapping(found) : null;
  }

  async getByNewApiUserId(newApiUserId: string | number) {
    const normalized = normalizeNewApiUserId(newApiUserId);
    const records = await this.storage.read();
    const found = records.find((record) => record.new_api_user_id === normalized);
    return found ? cloneMapping(found) : null;
  }

  async listByStatus(status: NewApiUserMappingStatus) {
    const records = await this.storage.read();
    return records.filter((record) => record.sync_status === status).map(cloneMapping);
  }

  async listMappingsPage(filter: NewApiUserMappingListFilter = {}) {
    const page = Math.max(1, Math.trunc(filter.page || 1));
    const pageSize = Math.min(100, Math.max(1, Math.trunc(filter.pageSize || 20)));
    const localUserId = filter.localUserId?.trim();
    const records = (await this.storage.read())
      .filter((record) => !filter.status || record.sync_status === filter.status)
      .filter((record) => !localUserId || record.local_user_id === localUserId)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .map(cloneMapping);
    const start = (page - 1) * pageSize;
    return {
      mappings: records.slice(start, start + pageSize),
      total: records.length,
    };
  }

  async createPending(input: NewApiUserMappingCreateInput) {
    const localUserId = normalizeLocalUserId(input.localUserId);
    const timestamp = nowIso(input.now);
    return this.mutate((records) => {
      const existing = records.find((record) => record.local_user_id === localUserId);
      if (existing) return cloneMapping(existing);

      const mapping: NewApiUserMapping = {
        local_user_id: localUserId,
        new_api_user_id: null,
        sync_status: "pending",
        created_at: timestamp,
        updated_at: timestamp,
        last_sync_at: null,
        last_error_code: null,
        last_error_message: null,
        retry_count: 0,
        version: 1,
        idempotency_key: input.idempotencyKey?.trim() || `new-api-user:${localUserId}:${randomUUID()}`,
      };
      records.push(mapping);
      return cloneMapping(mapping);
    });
  }

  async markActive(input: NewApiUserMappingTransitionInput & { newApiUserId: string | number }) {
    const localUserId = normalizeLocalUserId(input.localUserId);
    const newApiUserId = normalizeNewApiUserId(input.newApiUserId);
    return this.mutate((records) => {
      assertUniqueNewApiUserId(records, localUserId, newApiUserId);
      const index = records.findIndex((record) => record.local_user_id === localUserId);
      if (index < 0) throw mappingNotFound(localUserId);
      assertExpectedVersion(records[index], input.expectedVersion);

      records[index] = nextMapping(records[index], {
        new_api_user_id: newApiUserId,
        sync_status: "active",
        last_sync_at: nowIso(input.now),
        last_error_code: null,
        last_error_message: null,
      }, input.now);
      return cloneMapping(records[index]);
    });
  }

  async markFailed(input: NewApiUserMappingFailureInput) {
    const localUserId = normalizeLocalUserId(input.localUserId);
    const maxRetryCount = input.maxRetryCount ?? DEFAULT_MAX_RETRY_COUNT;
    return this.mutate((records) => {
      const index = records.findIndex((record) => record.local_user_id === localUserId);
      if (index < 0) throw mappingNotFound(localUserId);
      assertExpectedVersion(records[index], input.expectedVersion);

      const retryCount = records[index].retry_count + 1;
      const exhausted = !input.retryable || retryCount >= maxRetryCount;
      records[index] = nextMapping(records[index], {
        sync_status: exhausted ? "repair_required" : "failed",
        last_sync_at: nowIso(input.now),
        last_error_code: sanitizeErrorCode(input.code),
        last_error_message: sanitizeErrorMessage(input.message),
        retry_count: retryCount,
      }, input.now);
      return cloneMapping(records[index]);
    });
  }

  async markDisabled(input: NewApiUserMappingTransitionInput) {
    return this.setTerminalStatus("disabled", input);
  }

  async markOrphaned(input: NewApiUserMappingTransitionInput) {
    return this.setTerminalStatus("orphaned", input);
  }

  async scheduleRepair(input: NewApiUserMappingTransitionInput) {
    return this.setTerminalStatus("repair_required", input);
  }

  async prepareRetry(input: NewApiUserMappingPrepareRetryInput) {
    const localUserId = normalizeLocalUserId(input.localUserId);
    const maxRetryCount = input.maxRetryCount ?? DEFAULT_MAX_RETRY_COUNT;
    return this.mutate((records) => {
      const index = records.findIndex((record) => record.local_user_id === localUserId);
      if (index < 0) throw mappingNotFound(localUserId);
      assertExpectedVersion(records[index], input.expectedVersion);

      const current = records[index];
      if (current.retry_count >= maxRetryCount) {
        throw new NewApiUserMappingError({
          code: "NEW_API_MAPPING_RETRY_EXHAUSTED",
          message: "Mapping retry count is exhausted.",
          safeDetails: {
            local_user_id: localUserId,
            retry_count: current.retry_count,
            max_retry_count: maxRetryCount,
          },
        });
      }
      if (current.sync_status === "repair_required" && !input.allowRepairRequired) {
        throw new NewApiUserMappingError({
          code: "NEW_API_MAPPING_RETRY_EXHAUSTED",
          message: "Mapping requires manual repair before retry.",
          safeDetails: { local_user_id: localUserId },
        });
      }

      records[index] = nextMapping(current, {
        sync_status: "pending",
        last_sync_at: null,
        last_error_code: null,
        last_error_message: null,
      }, input.now);
      return cloneMapping(records[index]);
    });
  }

  private async setTerminalStatus(
    status: Extract<NewApiUserMappingStatus, "disabled" | "orphaned" | "repair_required">,
    input: NewApiUserMappingTransitionInput,
  ) {
    const localUserId = normalizeLocalUserId(input.localUserId);
    return this.mutate((records) => {
      const index = records.findIndex((record) => record.local_user_id === localUserId);
      if (index < 0) throw mappingNotFound(localUserId);
      assertExpectedVersion(records[index], input.expectedVersion);

      const newApiUserId = input.newApiUserId === undefined || input.newApiUserId === null
        ? records[index].new_api_user_id
        : normalizeNewApiUserId(input.newApiUserId);
      if (newApiUserId) assertUniqueNewApiUserId(records, localUserId, newApiUserId);

      records[index] = nextMapping(records[index], {
        sync_status: status,
        new_api_user_id: newApiUserId,
        last_sync_at: nowIso(input.now),
        last_error_code: input.code ? sanitizeErrorCode(input.code) : records[index].last_error_code,
        last_error_message: input.message
          ? sanitizeErrorMessage(input.message)
          : records[index].last_error_message,
      }, input.now);
      return cloneMapping(records[index]);
    });
  }
}

function mappingNotFound(localUserId: string) {
  return new NewApiUserMappingError({
    code: "NEW_API_MAPPING_NOT_FOUND",
    message: "New API user mapping was not found.",
    safeDetails: { local_user_id: localUserId },
  });
}

export function createMemoryNewApiUserMappingRepository(seed: NewApiUserMapping[] = []) {
  let records = cloneRecords(seed);
  return new NewApiUserMappingStoreRepository({
    async read() {
      return cloneRecords(records);
    },
    async write(nextRecords) {
      records = cloneRecords(nextRecords);
    },
  });
}

export function createJsonNewApiUserMappingRepository(path = defaultMappingPath) {
  return new NewApiUserMappingStoreRepository({
    async read() {
      return readJsonFile<NewApiUserMapping[]>(path, []);
    },
    async write(records) {
      await writeJsonFile(path, records);
    },
  });
}
