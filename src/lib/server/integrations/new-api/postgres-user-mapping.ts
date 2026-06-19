import "server-only";

import { type QueryResultRow } from "pg";

import { applicationQuery, getApplicationDatabaseConfig } from "../../database";
import {
  NewApiUserMappingError,
  type NewApiUserMapping,
  type NewApiUserMappingFailureInput,
  type NewApiUserMappingListFilter,
  type NewApiUserMappingPrepareRetryInput,
  type NewApiUserMappingRepository,
  type NewApiUserMappingStatus,
  type NewApiUserMappingTransitionInput,
} from "./user-mapping";
import { redactSecret } from "./redaction";

type MappingRow = QueryResultRow & {
  local_user_id: string;
  new_api_user_id: string | null;
  sync_status: NewApiUserMappingStatus;
  created_at: Date | string;
  updated_at: Date | string;
  last_sync_at: Date | string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  retry_count: number;
  version: number;
  idempotency_key: string;
};

const DEFAULT_MAX_RETRY_COUNT = 3;
const MAX_ERROR_MESSAGE_LENGTH = 300;

function iso(value: Date | string) {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function isoOrNull(value: Date | string | null) {
  return value === null ? null : iso(value);
}

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

function sanitizeErrorMessage(message: string) {
  return redactSecret(String(message || "sync failed")).slice(0, MAX_ERROR_MESSAGE_LENGTH);
}

function sanitizeErrorCode(code: string) {
  return String(code || "UNKNOWN").replace(/[^A-Z0-9_.:-]+/gi, "_").slice(0, 80);
}

function mappingFromRow(row: MappingRow): NewApiUserMapping {
  return {
    local_user_id: row.local_user_id,
    new_api_user_id: row.new_api_user_id,
    sync_status: row.sync_status,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    last_sync_at: isoOrNull(row.last_sync_at),
    last_error_code: row.last_error_code,
    last_error_message: row.last_error_message,
    retry_count: Number(row.retry_count),
    version: Number(row.version),
    idempotency_key: row.idempotency_key,
  };
}

function mappingNotFound(localUserId: string) {
  return new NewApiUserMappingError({
    code: "NEW_API_MAPPING_NOT_FOUND",
    message: "New API user mapping was not found.",
    safeDetails: { local_user_id: localUserId },
  });
}

function versionConflict(mapping: NewApiUserMapping, expectedVersion: number) {
  return new NewApiUserMappingError({
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

function mappingConflict(localUserId: string, newApiUserId: string) {
  return new NewApiUserMappingError({
    code: "NEW_API_MAPPING_CONFLICT",
    message: "New API user is already mapped to another local user.",
    safeDetails: {
      local_user_id: localUserId,
      new_api_user_id: newApiUserId,
    },
  });
}

function retryExhausted(localUserId: string, retryCount?: number, maxRetryCount?: number) {
  return new NewApiUserMappingError({
    code: "NEW_API_MAPPING_RETRY_EXHAUSTED",
    message: "Mapping retry count is exhausted.",
    safeDetails: {
      local_user_id: localUserId,
      retry_count: retryCount ?? null,
      max_retry_count: maxRetryCount ?? null,
    },
  });
}

async function getByLocalUserId(localUserId: string) {
  const result = await applicationQuery<MappingRow>(
    "select * from new_api_user_mappings where local_user_id = $1",
    [localUserId],
  );
  return result.rows[0] ? mappingFromRow(result.rows[0]) : null;
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && String((error as { code?: unknown }).code) === "23505";
}

export class PostgresNewApiUserMappingRepository implements NewApiUserMappingRepository {
  constructor() {
    getApplicationDatabaseConfig();
  }

  async getByLocalUserId(localUserId: string) {
    return getByLocalUserId(normalizeLocalUserId(localUserId));
  }

  async getByNewApiUserId(newApiUserId: string | number) {
    const normalized = normalizeNewApiUserId(newApiUserId);
    const result = await applicationQuery<MappingRow>(
      "select * from new_api_user_mappings where new_api_user_id = $1",
      [normalized],
    );
    return result.rows[0] ? mappingFromRow(result.rows[0]) : null;
  }

  async listByStatus(status: NewApiUserMappingStatus) {
    const result = await applicationQuery<MappingRow>(
      "select * from new_api_user_mappings where sync_status = $1 order by updated_at asc, local_user_id asc",
      [status],
    );
    return result.rows.map(mappingFromRow);
  }

  async listMappingsPage(filter: NewApiUserMappingListFilter = {}) {
    const values: unknown[] = [];
    const clauses: string[] = [];
    if (filter.status) {
      values.push(filter.status);
      clauses.push(`sync_status = $${values.length}`);
    }
    if (filter.localUserId?.trim()) {
      values.push(filter.localUserId.trim());
      clauses.push(`local_user_id = $${values.length}`);
    }
    const whereClause = clauses.length ? `where ${clauses.join(" and ")}` : "";
    const count = await applicationQuery<{ count: string }>(
      `select count(*)::text as count from new_api_user_mappings ${whereClause}`,
      values,
    );
    const page = Math.max(1, Math.trunc(filter.page || 1));
    const pageSize = Math.min(100, Math.max(1, Math.trunc(filter.pageSize || 20)));
    const queryValues = values.slice();
    queryValues.push(pageSize, (page - 1) * pageSize);
    const result = await applicationQuery<MappingRow>(`
      select *
      from new_api_user_mappings
      ${whereClause}
      order by updated_at desc, local_user_id desc
      limit $${queryValues.length - 1}
      offset $${queryValues.length}
    `, queryValues);
    return {
      mappings: result.rows.map(mappingFromRow),
      total: Number(count.rows[0]?.count || 0),
    };
  }

  async createPending(input: { localUserId: string; idempotencyKey?: string; now?: Date }) {
    const localUserId = normalizeLocalUserId(input.localUserId);
    const timestamp = nowIso(input.now);
    const idempotencyKey = input.idempotencyKey?.trim() || `new-api-user:${localUserId}`;
    try {
      const result = await applicationQuery<MappingRow>(`
        insert into new_api_user_mappings(
          local_user_id, new_api_user_id, sync_status, created_at, updated_at,
          last_sync_at, last_error_code, last_error_message, retry_count, version, idempotency_key
        ) values ($1,null,'pending',$2,$2,null,null,null,0,1,$3)
        on conflict (local_user_id) do nothing
        returning *
      `, [localUserId, timestamp, idempotencyKey]);
      if (result.rows[0]) return mappingFromRow(result.rows[0]);
      const existing = await getByLocalUserId(localUserId);
      if (existing) return existing;
      throw mappingNotFound(localUserId);
    } catch (error) {
      if (isUniqueViolation(error)) throw mappingConflict(localUserId, "");
      throw error;
    }
  }

  async markActive(input: NewApiUserMappingTransitionInput & { newApiUserId: string | number }) {
    const localUserId = normalizeLocalUserId(input.localUserId);
    const newApiUserId = normalizeNewApiUserId(input.newApiUserId);
    try {
      const result = await applicationQuery<MappingRow>(`
        update new_api_user_mappings
        set new_api_user_id = $2,
            sync_status = 'active',
            last_sync_at = $3,
            last_error_code = null,
            last_error_message = null,
            updated_at = $3,
            version = version + 1
        where local_user_id = $1
          and ($4::integer is null or version = $4)
        returning *
      `, [localUserId, newApiUserId, nowIso(input.now), input.expectedVersion ?? null]);
      if (result.rows[0]) return mappingFromRow(result.rows[0]);
      const current = await getByLocalUserId(localUserId);
      if (!current) throw mappingNotFound(localUserId);
      if (input.expectedVersion !== undefined) throw versionConflict(current, input.expectedVersion);
      throw mappingConflict(localUserId, newApiUserId);
    } catch (error) {
      if (isUniqueViolation(error)) throw mappingConflict(localUserId, newApiUserId);
      throw error;
    }
  }

  async markFailed(input: NewApiUserMappingFailureInput) {
    const localUserId = normalizeLocalUserId(input.localUserId);
    const current = await getByLocalUserId(localUserId);
    if (!current) throw mappingNotFound(localUserId);
    if (input.expectedVersion !== undefined && current.version !== input.expectedVersion) {
      throw versionConflict(current, input.expectedVersion);
    }

    const maxRetryCount = input.maxRetryCount ?? DEFAULT_MAX_RETRY_COUNT;
    const retryCount = current.retry_count + 1;
    const status = !input.retryable || retryCount >= maxRetryCount ? "repair_required" : "failed";
    const result = await applicationQuery<MappingRow>(`
      update new_api_user_mappings
      set sync_status = $2,
          last_sync_at = $3,
          last_error_code = $4,
          last_error_message = $5,
          retry_count = $6,
          updated_at = $3,
          version = version + 1
      where local_user_id = $1
      returning *
    `, [
      localUserId,
      status,
      nowIso(input.now),
      sanitizeErrorCode(input.code),
      sanitizeErrorMessage(input.message),
      retryCount,
    ]);
    return mappingFromRow(result.rows[0]);
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
    const current = await getByLocalUserId(localUserId);
    if (!current) throw mappingNotFound(localUserId);
    if (input.expectedVersion !== undefined && current.version !== input.expectedVersion) {
      throw versionConflict(current, input.expectedVersion);
    }

    const maxRetryCount = input.maxRetryCount ?? DEFAULT_MAX_RETRY_COUNT;
    if (current.retry_count >= maxRetryCount) throw retryExhausted(localUserId, current.retry_count, maxRetryCount);
    if (current.sync_status === "repair_required" && !input.allowRepairRequired) {
      throw retryExhausted(localUserId, current.retry_count, maxRetryCount);
    }

    const result = await applicationQuery<MappingRow>(`
      update new_api_user_mappings
      set sync_status = 'pending',
          last_sync_at = null,
          last_error_code = null,
          last_error_message = null,
          updated_at = $2,
          version = version + 1
      where local_user_id = $1
      returning *
    `, [localUserId, nowIso(input.now)]);
    return mappingFromRow(result.rows[0]);
  }

  private async setTerminalStatus(
    status: Extract<NewApiUserMappingStatus, "disabled" | "orphaned" | "repair_required">,
    input: NewApiUserMappingTransitionInput,
  ) {
    const localUserId = normalizeLocalUserId(input.localUserId);
    const current = await getByLocalUserId(localUserId);
    if (!current) throw mappingNotFound(localUserId);
    if (input.expectedVersion !== undefined && current.version !== input.expectedVersion) {
      throw versionConflict(current, input.expectedVersion);
    }
    const newApiUserId = input.newApiUserId === undefined || input.newApiUserId === null
      ? current.new_api_user_id
      : normalizeNewApiUserId(input.newApiUserId);
    try {
      const result = await applicationQuery<MappingRow>(`
        update new_api_user_mappings
        set sync_status = $2,
            new_api_user_id = $3,
            last_sync_at = $4,
            last_error_code = coalesce($5, last_error_code),
            last_error_message = coalesce($6, last_error_message),
            updated_at = $4,
            version = version + 1
        where local_user_id = $1
        returning *
      `, [
        localUserId,
        status,
        newApiUserId,
        nowIso(input.now),
        input.code ? sanitizeErrorCode(input.code) : null,
        input.message ? sanitizeErrorMessage(input.message) : null,
      ]);
      return mappingFromRow(result.rows[0]);
    } catch (error) {
      if (isUniqueViolation(error)) throw mappingConflict(localUserId, newApiUserId || "");
      throw error;
    }
  }
}

export function createPostgresNewApiUserMappingRepository() {
  return new PostgresNewApiUserMappingRepository();
}
