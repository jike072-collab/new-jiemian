import "server-only";

import { randomUUID } from "node:crypto";

import { type QueryResultRow } from "pg";

import { applicationQuery } from "../database";
import {
  TaskBillingRepositoryError,
  type CreateTaskBillingRecordInput,
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

function isUniqueViolation(error: unknown) {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && String((error as { code?: unknown }).code) === "23505";
}

export class PostgresTaskBillingRepository implements TaskBillingRepository {
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

  async createPrecheck(input: CreateTaskBillingRecordInput) {
    try {
      const timestamp = (input.now || new Date()).toISOString();
      const result = await applicationQuery<TaskBillingRecordRow>(`
        insert into task_billing_records(
          id, local_user_id, task_id, new_api_task_id, usage_record_id, idempotency_key,
          billing_state, estimated_quota_units, final_quota_units, created_at, updated_at,
          settled_at, refunded_at, last_error, version
        ) values ($1,$2,$3,null,$4,$5,'prechecked',$6,null,$7,$7,null,null,null,1)
        returning *
      `, [
        randomUUID(),
        input.localUserId.trim(),
        input.taskId.trim(),
        input.usageRecordId || null,
        input.idempotencyKey.trim(),
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
}

export function createPostgresTaskBillingRepository() {
  return new PostgresTaskBillingRepository();
}
