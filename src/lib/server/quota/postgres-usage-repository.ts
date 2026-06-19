import "server-only";

import { randomUUID } from "node:crypto";

import { type QueryResultRow } from "pg";

import { applicationQuery, getApplicationDatabaseConfig } from "../database";
import { type RecordUsageInput, type UsageLogRepository } from "./repository";
import { type BillableOperation, type UsageLogEntry, type UsageStatus } from "./types";

type UsageRow = QueryResultRow & {
  id: string;
  local_user_id: string;
  new_api_user_id: string | null;
  task_id: string;
  operation: BillableOperation;
  status: UsageStatus;
  estimated_quota_units: number;
  actual_quota_units: number | null;
  upstream_log_id: string | null;
  upstream_request_id: string | null;
  upstream_model: string | null;
  upstream_created_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  idempotency_key: string;
  error_code: string | null;
  error_message: string | null;
};

function iso(value: Date | string) {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function isoOrNull(value: Date | string | null) {
  return value === null ? null : iso(value);
}

function fromRow(row: UsageRow): UsageLogEntry {
  return {
    id: row.id,
    local_user_id: row.local_user_id,
    new_api_user_id: row.new_api_user_id,
    task_id: row.task_id,
    operation: row.operation,
    status: row.status,
    estimated_quota_units: Number(row.estimated_quota_units),
    actual_quota_units: row.actual_quota_units === null ? null : Number(row.actual_quota_units),
    upstream_log_id: row.upstream_log_id,
    upstream_request_id: row.upstream_request_id,
    upstream_model: row.upstream_model,
    upstream_created_at: isoOrNull(row.upstream_created_at),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    idempotency_key: row.idempotency_key,
    error_code: row.error_code,
    error_message: row.error_message,
  };
}

export class PostgresUsageLogRepository implements UsageLogRepository {
  constructor() {
    getApplicationDatabaseConfig();
  }

  async record(input: RecordUsageInput) {
    const timestamp = (input.now || new Date()).toISOString();
    const result = await applicationQuery<UsageRow>(`
      insert into usage_records(
        id, local_user_id, new_api_user_id, task_id, operation, status, estimated_quota_units,
        actual_quota_units, upstream_log_id, upstream_request_id, upstream_model, upstream_created_at,
        created_at, updated_at, idempotency_key, error_code, error_message, version
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13,$14,$15,$16,1)
      on conflict (idempotency_key) do update
      set new_api_user_id = excluded.new_api_user_id,
        task_id = excluded.task_id,
        operation = excluded.operation,
        status = excluded.status,
        estimated_quota_units = excluded.estimated_quota_units,
        actual_quota_units = excluded.actual_quota_units,
        upstream_log_id = excluded.upstream_log_id,
        upstream_request_id = excluded.upstream_request_id,
        upstream_model = excluded.upstream_model,
        upstream_created_at = excluded.upstream_created_at,
        updated_at = excluded.updated_at,
        error_code = excluded.error_code,
        error_message = excluded.error_message,
        version = usage_records.version + 1
      returning *
    `, [
      randomUUID(),
      input.localUserId.trim(),
      input.newApiUserId === undefined ? null : input.newApiUserId,
      input.taskId.trim(),
      input.operation,
      input.status,
      input.estimatedQuotaUnits,
      input.actualQuotaUnits === undefined ? null : input.actualQuotaUnits,
      input.upstreamLogId || null,
      input.upstreamRequestId || null,
      input.upstreamModel || null,
      input.upstreamCreatedAt || null,
      timestamp,
      input.idempotencyKey.trim(),
      input.errorCode || null,
      input.errorMessage || null,
    ]);
    return fromRow(result.rows[0]);
  }

  async listForUser(localUserId: string, page = 1, pageSize = 20) {
    const safePage = Math.max(1, Math.floor(page));
    const safePageSize = Math.min(100, Math.max(1, Math.floor(pageSize)));
    const count = await applicationQuery<{ count: string }>(
      "select count(*)::text as count from usage_records where local_user_id = $1",
      [localUserId.trim()],
    );
    const result = await applicationQuery<UsageRow>(`
      select *
      from usage_records
      where local_user_id = $1
      order by created_at desc, id desc
      limit $2 offset $3
    `, [localUserId.trim(), safePageSize, (safePage - 1) * safePageSize]);
    return {
      entries: result.rows.map(fromRow),
      page: safePage,
      pageSize: safePageSize,
      total: Number(count.rows[0]?.count || 0),
    };
  }

  async getByTaskId(localUserId: string, taskId: string) {
    const result = await applicationQuery<UsageRow>(`
      select *
      from usage_records
      where local_user_id = $1 and task_id = $2
    `, [localUserId.trim(), taskId.trim()]);
    return result.rows[0] ? fromRow(result.rows[0]) : null;
  }
}

export function createPostgresUsageLogRepository() {
  return new PostgresUsageLogRepository();
}
