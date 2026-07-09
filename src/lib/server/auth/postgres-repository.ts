import "server-only";

import { randomUUID } from "node:crypto";

import { type QueryResultRow } from "pg";

import { applicationQuery, getApplicationDatabaseConfig } from "../database";
import { nowIso, normalizeAuthIdentifier, normalizeEmail, normalizeIdentifier, normalizePhone, normalizeUsername } from "./normalize";
import {
  AuthRepositoryError,
  type AuthUserListFilter,
  type AuthRepository,
  type CreateAuthUserInput,
} from "./repository";
import {
  type AuthAuditEvent,
  type AuthVerificationCode,
  type AuthVerificationChannel,
  type AuthVerificationPurpose,
  type AuthSession,
  type AuthUser,
  type AuthUserRole,
  type AuthUserStatus,
} from "./types";

type UserRow = QueryResultRow & {
  local_user_id: string;
  email: string;
  phone: string | null;
  username: string;
  display_name: string;
  password_hash: string;
  status: AuthUserStatus;
  role: AuthUserRole;
  session_version: number;
  created_at: Date | string;
  updated_at: Date | string;
  last_login_at: Date | string | null;
};

type VerificationCodeRow = QueryResultRow & {
  verification_id: string;
  destination: string;
  channel: AuthVerificationChannel;
  purpose: AuthVerificationPurpose;
  code_hash: string;
  expires_at: Date | string;
  consumed_at: Date | string | null;
  attempt_count: number;
  send_count: number;
  created_at: Date | string;
  updated_at: Date | string;
};

type SessionRow = QueryResultRow & {
  session_id: string;
  local_user_id: string;
  token_hash: string;
  session_version: number;
  created_at: Date | string;
  updated_at: Date | string;
  last_seen_at: Date | string;
  idle_expires_at: Date | string;
  expires_at: Date | string;
  revoked_at: Date | string | null;
  user_agent_hash: string | null;
  ip_hash: string | null;
};

type AuditRow = QueryResultRow & {
  id: string;
  event: string;
  local_user_id: string | null;
  created_at: Date | string;
  request_id: string | null;
  ip_hash: string | null;
  user_agent_hash: string | null;
  safe_details: Record<string, string | number | boolean | null> | null;
};

function iso(value: Date | string) {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function isoOrNull(value: Date | string | null) {
  return value === null ? null : iso(value);
}

function userFromRow(row: UserRow): AuthUser {
  return {
    local_user_id: row.local_user_id,
    email: row.email,
    phone: row.phone,
    username: row.username,
    display_name: row.display_name,
    password_hash: row.password_hash,
    status: row.status,
    role: row.role,
    session_version: Number(row.session_version),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    last_login_at: isoOrNull(row.last_login_at),
  };
}

function verificationCodeFromRow(row: VerificationCodeRow): AuthVerificationCode {
  return {
    verification_id: row.verification_id,
    destination: row.destination,
    channel: row.channel,
    purpose: row.purpose,
    code_hash: row.code_hash,
    expires_at: iso(row.expires_at),
    consumed_at: isoOrNull(row.consumed_at),
    attempt_count: Number(row.attempt_count),
    send_count: Number(row.send_count),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

function sessionFromRow(row: SessionRow): AuthSession {
  return {
    session_id: row.session_id,
    local_user_id: row.local_user_id,
    token_hash: row.token_hash,
    session_version: Number(row.session_version),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    last_seen_at: iso(row.last_seen_at),
    idle_expires_at: iso(row.idle_expires_at),
    expires_at: iso(row.expires_at),
    revoked_at: isoOrNull(row.revoked_at),
    user_agent_hash: row.user_agent_hash,
    ip_hash: row.ip_hash,
  };
}

function auditFromRow(row: AuditRow): AuthAuditEvent {
  return {
    id: row.id,
    event: row.event,
    local_user_id: row.local_user_id,
    created_at: iso(row.created_at),
    request_id: row.request_id,
    ip_hash: row.ip_hash,
    user_agent_hash: row.user_agent_hash,
    details: row.safe_details || {},
  };
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && String((error as { code?: unknown }).code) === "23505";
}

export class PostgresAuthRepository implements AuthRepository {
  constructor() {
    getApplicationDatabaseConfig();
  }

  async getUserById(localUserId: string) {
    const result = await applicationQuery<UserRow>(
      "select * from app_users where local_user_id = $1",
      [localUserId.trim()],
    );
    return result.rows[0] ? userFromRow(result.rows[0]) : null;
  }

  async getUserByIdentifier(identifier: string) {
    const authIdentifier = normalizeAuthIdentifier(identifier);
    const normalized = authIdentifier?.kind === "phone" ? authIdentifier.value : normalizeIdentifier(identifier);
    const result = await applicationQuery<UserRow>(
      "select * from app_users where email = $1 or username = $1 or phone = $1 limit 1",
      [normalized],
    );
    return result.rows[0] ? userFromRow(result.rows[0]) : null;
  }

  async listUsersPage(filter: AuthUserListFilter = {}) {
    const values: unknown[] = [];
    const clauses: string[] = [];
    if (filter.status) {
      values.push(filter.status);
      clauses.push(`status = $${values.length}`);
    }
    if (filter.role) {
      values.push(filter.role);
      clauses.push(`role = $${values.length}`);
    }
    const query = normalizeIdentifier(filter.query || "");
    if (query) {
      values.push(`%${query}%`);
      values.push(query);
      clauses.push(`(email like $${values.length - 1} or username like $${values.length - 1} or phone like $${values.length - 1} or local_user_id = $${values.length})`);
    }
    const whereClause = clauses.length ? `where ${clauses.join(" and ")}` : "";
    const count = await applicationQuery<{ count: string }>(
      `select count(*)::text as count from app_users ${whereClause}`,
      values,
    );
    const page = Math.max(1, Math.trunc(filter.page || 1));
    const pageSize = Math.min(100, Math.max(1, Math.trunc(filter.pageSize || 20)));
    const queryValues = values.slice();
    queryValues.push(pageSize, (page - 1) * pageSize);
    const result = await applicationQuery<UserRow>(`
      select *
      from app_users
      ${whereClause}
      order by created_at desc, local_user_id desc
      limit $${queryValues.length - 1}
      offset $${queryValues.length}
    `, queryValues);
    return {
      users: result.rows.map(userFromRow),
      total: Number(count.rows[0]?.count || 0),
    };
  }

  async createUser(input: CreateAuthUserInput) {
    const email = normalizeEmail(input.email);
    const phone = input.phone ? normalizePhone(input.phone) : null;
    const username = normalizeUsername(input.username);
    const timestamp = nowIso(input.now);
    try {
      const result = await applicationQuery<UserRow>(`
        insert into app_users(
          local_user_id, email, phone, username, display_name, password_hash, status, role,
          session_version, created_at, updated_at, last_login_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,1,$9,$9,null)
        returning *
      `, [
        input.localUserId || randomUUID(),
        email,
        phone,
        username,
        input.displayName.trim() || username,
        input.passwordHash,
        input.status || "active",
        input.role || "user",
        timestamp,
      ]);
      return userFromRow(result.rows[0]);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AuthRepositoryError("AUTH_DUPLICATE_ACCOUNT", "Account already exists.");
      }
      throw error;
    }
  }

  async updateUser(
    localUserId: string,
    patch: Partial<Pick<AuthUser, "status" | "last_login_at" | "session_version" | "display_name" | "password_hash">>,
    now?: Date,
  ) {
    const values: unknown[] = [localUserId];
    const assignments: string[] = [];
    const add = (column: string, value: unknown) => {
      values.push(value);
      assignments.push(`${column} = $${values.length}`);
    };

    if (patch.status !== undefined) add("status", patch.status);
    if (patch.last_login_at !== undefined) add("last_login_at", patch.last_login_at);
    if (patch.session_version !== undefined) add("session_version", patch.session_version);
    if (patch.display_name !== undefined) add("display_name", patch.display_name);
    if (patch.password_hash !== undefined) add("password_hash", patch.password_hash);
    add("updated_at", nowIso(now));

    const result = await applicationQuery<UserRow>(`
      update app_users
      set ${assignments.join(", ")}
      where local_user_id = $1
      returning *
    `, values);
    if (!result.rows[0]) throw new AuthRepositoryError("AUTH_NOT_FOUND", "Account was not found.");
    return userFromRow(result.rows[0]);
  }

  async releaseUserIdentity(localUserId: string, now?: Date) {
    const timestamp = nowIso(now);
    const compact = localUserId.trim().toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 24) || randomUUID().replace(/-/g, "").slice(0, 24);
    const result = await applicationQuery<UserRow>(`
      update app_users
      set
        email = $2,
        username = $3,
        phone = null,
        session_version = session_version + 1,
        updated_at = $4
      where local_user_id = $1
      returning *
    `, [
      localUserId,
      `archived+${compact}@deleted.local`,
      `archived-${compact}`.slice(0, 32),
      timestamp,
    ]);
    if (!result.rows[0]) throw new AuthRepositoryError("AUTH_NOT_FOUND", "Account was not found.");
    await applicationQuery(`
      update auth_sessions
      set revoked_at = $2, updated_at = $2
      where local_user_id = $1 and revoked_at is null
    `, [localUserId, timestamp]);
    return userFromRow(result.rows[0]);
  }

  async createSession(session: AuthSession) {
    const result = await applicationQuery<SessionRow>(`
      insert into auth_sessions(
        session_id, local_user_id, token_hash, session_version, created_at, updated_at,
        last_seen_at, idle_expires_at, expires_at, revoked_at, user_agent_hash, ip_hash
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      returning *
    `, [
      session.session_id,
      session.local_user_id,
      session.token_hash,
      session.session_version,
      session.created_at,
      session.updated_at,
      session.last_seen_at,
      session.idle_expires_at,
      session.expires_at,
      session.revoked_at,
      session.user_agent_hash,
      session.ip_hash,
    ]);
    return sessionFromRow(result.rows[0]);
  }

  async getSessionByTokenHash(tokenHash: string) {
    const result = await applicationQuery<SessionRow>(
      "select * from auth_sessions where token_hash = $1",
      [tokenHash],
    );
    return result.rows[0] ? sessionFromRow(result.rows[0]) : null;
  }

  async touchSession(
    sessionId: string,
    patch: Pick<AuthSession, "last_seen_at" | "idle_expires_at" | "updated_at">,
  ) {
    const result = await applicationQuery<SessionRow>(`
      update auth_sessions
      set last_seen_at = $2, idle_expires_at = $3, updated_at = $4, version = version + 1
      where session_id = $1
      returning *
    `, [sessionId, patch.last_seen_at, patch.idle_expires_at, patch.updated_at]);
    if (!result.rows[0]) throw new AuthRepositoryError("AUTH_NOT_FOUND", "Session was not found.");
    return sessionFromRow(result.rows[0]);
  }

  async revokeSession(sessionId: string, now?: Date) {
    const timestamp = nowIso(now);
    const result = await applicationQuery<SessionRow>(`
      update auth_sessions
      set revoked_at = coalesce(revoked_at, $2), updated_at = $2, version = version + 1
      where session_id = $1
      returning *
    `, [sessionId, timestamp]);
    return result.rows[0] ? sessionFromRow(result.rows[0]) : null;
  }

  async createVerificationCode(code: AuthVerificationCode) {
    const result = await applicationQuery<VerificationCodeRow>(`
      insert into auth_verification_codes(
        verification_id, destination, channel, purpose, code_hash, expires_at, consumed_at,
        attempt_count, send_count, created_at, updated_at
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      returning *
    `, [
      code.verification_id,
      code.destination,
      code.channel,
      code.purpose,
      code.code_hash,
      code.expires_at,
      code.consumed_at,
      code.attempt_count,
      code.send_count,
      code.created_at,
      code.updated_at,
    ]);
    return verificationCodeFromRow(result.rows[0]);
  }

  async getLatestVerificationCode(input: Pick<AuthVerificationCode, "destination" | "purpose">) {
    const result = await applicationQuery<VerificationCodeRow>(`
      select *
      from auth_verification_codes
      where destination = $1
        and purpose = $2
        and consumed_at is null
      order by created_at desc, verification_id desc
      limit 1
    `, [input.destination, input.purpose]);
    return result.rows[0] ? verificationCodeFromRow(result.rows[0]) : null;
  }

  async touchVerificationCode(
    verificationId: string,
    patch: Partial<Pick<AuthVerificationCode, "attempt_count" | "consumed_at" | "updated_at">>,
  ) {
    const values: unknown[] = [verificationId];
    const assignments: string[] = [];
    const add = (column: string, value: unknown) => {
      values.push(value);
      assignments.push(`${column} = $${values.length}`);
    };

    if (patch.attempt_count !== undefined) add("attempt_count", patch.attempt_count);
    if (patch.consumed_at !== undefined) add("consumed_at", patch.consumed_at);
    if (patch.updated_at !== undefined) add("updated_at", patch.updated_at);
    if (!assignments.length) add("updated_at", nowIso());

    const result = await applicationQuery<VerificationCodeRow>(`
      update auth_verification_codes
      set ${assignments.join(", ")}
      where verification_id = $1
      returning *
    `, values);
    if (!result.rows[0]) throw new AuthRepositoryError("AUTH_NOT_FOUND", "Verification code was not found.");
    return verificationCodeFromRow(result.rows[0]);
  }

  async appendAudit(event: AuthAuditEvent) {
    await applicationQuery(`
      insert into audit_events(
        id, event, local_user_id, created_at, request_id, ip_hash, user_agent_hash, safe_details
      ) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
    `, [
      event.id,
      event.event,
      event.local_user_id,
      event.created_at,
      event.request_id,
      event.ip_hash,
      event.user_agent_hash,
      JSON.stringify(event.details || {}),
    ]);
  }

  async listAuditEvents() {
    const result = await applicationQuery<AuditRow>(
      "select * from audit_events order by created_at asc, id asc",
    );
    return result.rows.map(auditFromRow);
  }
}

export function createPostgresAuthRepository() {
  return new PostgresAuthRepository();
}
