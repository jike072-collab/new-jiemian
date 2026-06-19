import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { type QueryResultRow } from "pg";

import {
  applicationQuery,
  getApplicationDatabaseConfig,
  getApplicationDatabasePool,
  withApplicationTransaction,
} from "../database";
import {
  TaskBillingRepositoryError,
  type CreateTaskBillingRecordInput,
  type TaskQuotaAdjustment,
  type TaskQuotaAdjustmentInput,
  type TaskQuotaAdjustmentStatus,
  type TaskBillingRecordListFilter,
  type TaskBillingRecordPatch,
  type TaskBillingRepository,
} from "./task-billing-repository";
import { type TaskBillingRecord, type TaskBillingState } from "./task-billing-types";

type TaskBillingRecordRow = QueryResultRow & {
  id: string;
  local_user_id: string;
  task_id: string;
  new_api_task_id: string | null;
  usage_record_id: string | null;
  idempotency_key: string;
  request_fingerprint: string | null;
  billing_state: TaskBillingState;
  estimated_quota_units: number;
  final_quota_units: number | null;
  created_at: Date | string;
  updated_at: Date | string;
  settled_at: Date | string | null;
  refunded_at: Date | string | null;
  last_error: string | null;
  version: number;
};

type TaskQuotaAdjustmentRow = QueryResultRow & {
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
  created_at: Date | string;
  updated_at: Date | string;
  applied_at: Date | string | null;
  version: number;
  created?: boolean;
};

function iso(value: Date | string) {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function isoOrNull(value: Date | string | null) {
  return value === null ? null : iso(value);
}

function fromRow(row: TaskBillingRecordRow): TaskBillingRecord {
  return {
    id: row.id,
    local_user_id: row.local_user_id,
    task_id: row.task_id,
    new_api_task_id: row.new_api_task_id,
    usage_record_id: row.usage_record_id,
    idempotency_key: row.idempotency_key,
    request_fingerprint: row.request_fingerprint,
    billing_state: row.billing_state,
    estimated_quota_units: Number(row.estimated_quota_units),
    final_quota_units: row.final_quota_units === null ? null : Number(row.final_quota_units),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    settled_at: isoOrNull(row.settled_at),
    refunded_at: isoOrNull(row.refunded_at),
    last_error: row.last_error,
    version: Number(row.version),
  };
}

function adjustmentFromRow(row: TaskQuotaAdjustmentRow): TaskQuotaAdjustment {
  return {
    id: row.id,
    local_user_id: row.local_user_id,
    new_api_user_id: row.new_api_user_id,
    task_billing_record_id: row.task_billing_record_id,
    task_id: row.task_id,
    idempotency_key: row.idempotency_key,
    quota_delta: Number(row.quota_delta),
    original_quota: row.original_quota === null ? null : Number(row.original_quota),
    target_quota: row.target_quota === null ? null : Number(row.target_quota),
    status: row.status,
    provider_adjustment_id: row.provider_adjustment_id,
    last_error: row.last_error,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    applied_at: isoOrNull(row.applied_at),
    version: Number(row.version),
    created: Boolean(row.created),
  };
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && String((error as { code?: unknown }).code) === "23505";
}

function advisoryKeyParts(value: string): [number, number] {
  const hash = createHash("sha256").update(value).digest();
  return [hash.readInt32BE(0), hash.readInt32BE(4)];
}

export class PostgresTaskBillingRepository implements TaskBillingRepository {
  constructor() {
    getApplicationDatabaseConfig();
  }

  async withQuotaAdjustmentLock<T>(newApiUserId: string, operation: () => Promise<T>) {
    const client = await getApplicationDatabasePool().connect();
    const [key1, key2] = advisoryKeyParts(`task-quota:${newApiUserId.trim()}`);
    try {
      await client.query("select pg_advisory_lock($1, $2)", [key1, key2]);
      return operation();
    } finally {
      await client.query("select pg_advisory_unlock($1, $2)", [key1, key2]).catch(() => undefined);
      client.release();
    }
  }

  async getByTaskId(localUserId: string, taskId: string) {
    const result = await applicationQuery<TaskBillingRecordRow>(`
      select *
      from task_billing_records
      where local_user_id = $1 and task_id = $2
    `, [localUserId.trim(), taskId.trim()]);
    return result.rows[0] ? fromRow(result.rows[0]) : null;
  }

  async getByIdempotencyKey(localUserId: string, idempotencyKey: string) {
    const result = await applicationQuery<TaskBillingRecordRow>(`
      select *
      from task_billing_records
      where local_user_id = $1 and idempotency_key = $2
    `, [localUserId.trim(), idempotencyKey.trim()]);
    return result.rows[0] ? fromRow(result.rows[0]) : null;
  }

  async listRecordsPage(filter: TaskBillingRecordListFilter = {}) {
    const values: unknown[] = [];
    const clauses: string[] = [];
    if (filter.localUserId?.trim()) {
      values.push(filter.localUserId.trim());
      clauses.push(`local_user_id = $${values.length}`);
    }
    if (filter.taskId?.trim()) {
      values.push(filter.taskId.trim());
      clauses.push(`task_id = $${values.length}`);
    }
    if (filter.states?.length) {
      values.push(filter.states);
      clauses.push(`billing_state = any($${values.length}::text[])`);
    }
    const whereClause = clauses.length ? `where ${clauses.join(" and ")}` : "";
    const count = await applicationQuery<{ count: string }>(
      `select count(*)::text as count from task_billing_records ${whereClause}`,
      values,
    );
    const page = Math.max(1, Math.trunc(filter.page || 1));
    const pageSize = Math.min(100, Math.max(1, Math.trunc(filter.pageSize || 20)));
    const queryValues = values.slice();
    queryValues.push(pageSize, (page - 1) * pageSize);
    const result = await applicationQuery<TaskBillingRecordRow>(`
      select *
      from task_billing_records
      ${whereClause}
      order by updated_at desc, id desc
      limit $${queryValues.length - 1}
      offset $${queryValues.length}
    `, queryValues);
    return {
      records: result.rows.map(fromRow),
      total: Number(count.rows[0]?.count || 0),
    };
  }

  async createPrecheck(input: CreateTaskBillingRecordInput) {
    try {
      const timestamp = (input.now || new Date()).toISOString();
      const result = await applicationQuery<TaskBillingRecordRow>(`
        insert into task_billing_records(
          id, local_user_id, task_id, new_api_task_id, usage_record_id, idempotency_key,
          request_fingerprint, billing_state, estimated_quota_units, final_quota_units, created_at, updated_at,
          settled_at, refunded_at, last_error, version
        ) values ($1,$2,$3,null,$4,$5,$6,'prechecked',$7,null,$8,$8,null,null,null,1)
        returning *
      `, [
        randomUUID(),
        input.localUserId.trim(),
        input.taskId.trim(),
        input.usageRecordId || null,
        input.idempotencyKey.trim(),
        input.requestFingerprint || null,
        input.estimatedQuotaUnits,
        timestamp,
      ]);
      return fromRow(result.rows[0]);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new TaskBillingRepositoryError("TASK_BILLING_DUPLICATE", "Task billing record already exists.");
      }
      throw error;
    }
  }

  async update(recordId: string, patch: TaskBillingRecordPatch, expectedVersion?: number) {
    const values: unknown[] = [recordId.trim()];
    const assignments: string[] = [];
    const add = (column: string, value: unknown) => {
      values.push(value);
      assignments.push(`${column} = $${values.length}`);
    };

    if (patch.new_api_task_id !== undefined) add("new_api_task_id", patch.new_api_task_id);
    if (patch.usage_record_id !== undefined) add("usage_record_id", patch.usage_record_id);
    if (patch.billing_state !== undefined) add("billing_state", patch.billing_state);
    if (patch.final_quota_units !== undefined) add("final_quota_units", patch.final_quota_units);
    if (patch.updated_at !== undefined) add("updated_at", patch.updated_at);
    if (patch.settled_at !== undefined) add("settled_at", patch.settled_at);
    if (patch.refunded_at !== undefined) add("refunded_at", patch.refunded_at);
    if (patch.last_error !== undefined) add("last_error", patch.last_error);
    assignments.push("version = version + 1");

    const expectedClause = expectedVersion === undefined ? "" : ` and version = $${values.length + 1}`;
    if (expectedVersion !== undefined) values.push(expectedVersion);
    const result = await applicationQuery<TaskBillingRecordRow>(`
      update task_billing_records
      set ${assignments.join(", ")}
      where id = $1${expectedClause}
      returning *
    `, values);
    if (result.rows[0]) return fromRow(result.rows[0]);
    const current = await applicationQuery<TaskBillingRecordRow>(
      "select * from task_billing_records where id = $1",
      [recordId.trim()],
    );
    if (!current.rows[0]) {
      throw new TaskBillingRepositoryError("TASK_BILLING_NOT_FOUND", "Task billing record was not found.");
    }
    throw new TaskBillingRepositoryError("TASK_BILLING_VERSION_CONFLICT", "Task billing record changed before update.");
  }

  async claimQuotaAdjustment(input: TaskQuotaAdjustmentInput) {
    const timestamp = (input.now || new Date()).toISOString();
    return withApplicationTransaction(async (client) => {
      const inserted = await client.query<{ id: string }>(`
        insert into task_quota_adjustments(
          id, local_user_id, new_api_user_id, task_billing_record_id, task_id, idempotency_key,
          quota_delta, original_quota, target_quota, status, provider_adjustment_id, last_error, created_at, updated_at,
          applied_at, version
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',null,null,$10,$10,null,1)
        on conflict (idempotency_key) do nothing
        returning id
      `, [
        randomUUID(),
        input.localUserId.trim(),
        input.newApiUserId.trim(),
        input.taskBillingRecordId || null,
        input.taskId.trim(),
        input.idempotencyKey.trim(),
        input.quotaDelta,
        input.originalQuota ?? null,
        input.targetQuota ?? null,
        timestamp,
      ]);
      const current = await client.query<TaskQuotaAdjustmentRow & { created: boolean }>(`
        select *
        , $2::boolean as created
        from task_quota_adjustments
        where idempotency_key = $1
        for update
      `, [input.idempotencyKey.trim(), inserted.rowCount === 1]);
      if (!current.rows[0]) {
        throw new TaskBillingRepositoryError("TASK_BILLING_NOT_FOUND", "Task quota adjustment was not found.");
      }
      const row = current.rows[0];
      if (row.status === "failed") {
        const retried = await client.query<TaskQuotaAdjustmentRow & { created: boolean }>(`
          update task_quota_adjustments
          set status = 'pending',
            original_quota = coalesce($2, original_quota),
            target_quota = coalesce($3, target_quota),
            last_error = null,
            updated_at = $4,
            version = version + 1
          where idempotency_key = $1
          returning *, false as created
        `, [input.idempotencyKey.trim(), input.originalQuota ?? null, input.targetQuota ?? null, timestamp]);
        return adjustmentFromRow(retried.rows[0]);
      }
      return adjustmentFromRow(row);
    });
  }

  async markQuotaAdjustmentApplied(idempotencyKey: string, providerAdjustmentId: string, now?: Date) {
    const timestamp = (now || new Date()).toISOString();
    return this.updateQuotaAdjustment(idempotencyKey, `
      status = 'applied',
      provider_adjustment_id = $2,
      last_error = null,
      applied_at = coalesce(applied_at, $3),
      updated_at = $3,
      version = version + 1
    `, [providerAdjustmentId, timestamp]);
  }

  async markQuotaAdjustmentFailed(idempotencyKey: string, error: string, now?: Date) {
    const timestamp = (now || new Date()).toISOString();
    return this.updateQuotaAdjustment(idempotencyKey, `
      status = 'failed',
      last_error = $2,
      updated_at = $3,
      version = version + 1
    `, [error, timestamp]);
  }

  private async updateQuotaAdjustment(idempotencyKey: string, assignmentSql: string, values: unknown[]) {
    const result = await applicationQuery<TaskQuotaAdjustmentRow>(`
      update task_quota_adjustments
      set ${assignmentSql}
      where idempotency_key = $1
      returning *
    `, [idempotencyKey.trim(), ...values]);
    if (result.rows[0]) return adjustmentFromRow(result.rows[0]);
    throw new TaskBillingRepositoryError("TASK_BILLING_NOT_FOUND", "Task quota adjustment was not found.");
  }
}

export function createPostgresTaskBillingRepository() {
  return new PostgresTaskBillingRepository();
}
