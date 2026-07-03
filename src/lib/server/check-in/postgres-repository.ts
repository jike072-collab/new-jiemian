import "server-only";

import { randomUUID } from "node:crypto";

import { type QueryResultRow } from "pg";

import { applicationQuery, getApplicationDatabaseConfig, withApplicationTransaction } from "../database";
import {
  type DailyCheckInClaimInput,
  type DailyCheckInRecord,
  type DailyCheckInRepository,
  type DailyCheckInStatus,
} from "./repository";

type DailyCheckInRow = QueryResultRow & {
  id: string;
  local_user_id: string;
  new_api_user_id: string;
  checkin_date: Date | string;
  quota_delta: number;
  status: DailyCheckInStatus;
  provider_adjustment_id: string | null;
  last_error: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  claimed_at: Date | string | null;
  version: number;
  created?: boolean;
};

const MAX_ERROR_MESSAGE_LENGTH = 240;

function iso(value: Date | string) {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function isoOrNull(value: Date | string | null) {
  return value === null ? null : iso(value);
}

function dateOnly(value: Date | string) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function sanitizeError(value: string) {
  return String(value || "Daily check-in failed.")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/Authorization[=:]\s*[^,\s}]+/gi, "Authorization=[REDACTED]")
    .replace(/(token|password|cookie|secret|key)[=:]\s*[^,\s}]+/gi, "$1=[REDACTED]")
    .slice(0, MAX_ERROR_MESSAGE_LENGTH);
}

function fromRow(row: DailyCheckInRow): DailyCheckInRecord {
  return {
    id: row.id,
    local_user_id: row.local_user_id,
    new_api_user_id: row.new_api_user_id,
    checkin_date: dateOnly(row.checkin_date),
    quota_delta: Number(row.quota_delta),
    status: row.status,
    provider_adjustment_id: row.provider_adjustment_id,
    last_error: row.last_error,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    claimed_at: isoOrNull(row.claimed_at),
    version: Number(row.version),
    created: Boolean(row.created),
  };
}

export class PostgresDailyCheckInRepository implements DailyCheckInRepository {
  constructor() {
    getApplicationDatabaseConfig();
  }

  async getForDate(localUserId: string, checkInDate: string) {
    const result = await applicationQuery<DailyCheckInRow>(`
      select *
      from daily_checkins
      where local_user_id = $1 and checkin_date = $2::date
    `, [localUserId.trim(), checkInDate.trim()]);
    return result.rows[0] ? fromRow(result.rows[0]) : null;
  }

  async claimForDate(input: DailyCheckInClaimInput) {
    const timestamp = (input.now || new Date()).toISOString();
    return withApplicationTransaction(async (client) => {
      const inserted = await client.query<{ id: string }>(`
        insert into daily_checkins(
          id, local_user_id, new_api_user_id, checkin_date, quota_delta, status,
          provider_adjustment_id, last_error, created_at, updated_at, claimed_at, version
        ) values ($1,$2,$3,$4::date,$5,'pending',null,null,$6,$6,null,1)
        on conflict (local_user_id, checkin_date) do nothing
        returning id
      `, [
        randomUUID(),
        input.localUserId.trim(),
        input.newApiUserId.trim(),
        input.checkInDate.trim(),
        input.quotaDelta,
        timestamp,
      ]);
      const current = await client.query<DailyCheckInRow & { created: boolean }>(`
        select *, $3::boolean as created
        from daily_checkins
        where local_user_id = $1 and checkin_date = $2::date
        for update
      `, [input.localUserId.trim(), input.checkInDate.trim(), inserted.rowCount === 1]);
      const row = current.rows[0];
      if (!row) throw new Error("Daily check-in record was not found.");
      if (row.status === "failed") {
        const retried = await client.query<DailyCheckInRow & { created: boolean }>(`
          update daily_checkins
          set status = 'pending',
            new_api_user_id = $3,
            quota_delta = $4,
            last_error = null,
            updated_at = $5,
            version = version + 1
          where local_user_id = $1 and checkin_date = $2::date
          returning *, false as created
        `, [
          input.localUserId.trim(),
          input.checkInDate.trim(),
          input.newApiUserId.trim(),
          input.quotaDelta,
          timestamp,
        ]);
        return fromRow(retried.rows[0]);
      }
      return fromRow(row);
    });
  }

  async markCredited(recordId: string, providerAdjustmentId: string, now?: Date) {
    const timestamp = (now || new Date()).toISOString();
    const result = await applicationQuery<DailyCheckInRow>(`
      update daily_checkins
      set status = 'credited',
        provider_adjustment_id = $2,
        last_error = null,
        claimed_at = coalesce(claimed_at, $3),
        updated_at = $3,
        version = version + 1
      where id = $1
      returning *
    `, [recordId.trim(), providerAdjustmentId.trim(), timestamp]);
    if (result.rows[0]) return fromRow(result.rows[0]);
    throw new Error("Daily check-in record was not found.");
  }

  async markFailed(recordId: string, error: string, now?: Date) {
    const timestamp = (now || new Date()).toISOString();
    const result = await applicationQuery<DailyCheckInRow>(`
      update daily_checkins
      set status = 'failed',
        last_error = $2,
        updated_at = $3,
        version = version + 1
      where id = $1
      returning *
    `, [recordId.trim(), sanitizeError(error), timestamp]);
    if (result.rows[0]) return fromRow(result.rows[0]);
    throw new Error("Daily check-in record was not found.");
  }

  async listForUser(localUserId: string, limit = 20) {
    const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)));
    const result = await applicationQuery<DailyCheckInRow>(`
      select *
      from daily_checkins
      where local_user_id = $1
      order by created_at desc, id desc
      limit $2
    `, [localUserId.trim(), safeLimit]);
    return result.rows.map(fromRow);
  }
}

export function createPostgresDailyCheckInRepository() {
  return new PostgresDailyCheckInRepository();
}
