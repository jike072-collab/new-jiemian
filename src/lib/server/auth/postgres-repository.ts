import "server-only";

import { randomUUID } from "node:crypto";

import { type QueryResultRow } from "pg";

import { applicationQuery, getApplicationDatabaseConfig } from "../database";
import { nowIso, normalizeEmail, normalizeIdentifier, normalizeUsername } from "./normalize";
import {
  AuthRepositoryError,
  type AuthUserListFilter,
  type AuthRepository,
  type CreateAuthUserInput,
} from "./repository";
import {
  type AuthAuditEvent,
  type AuthSession,
  type AuthUser,
  type AuthUserRole,
  type AuthUserStatus,
} from "./types";

type UserRow = QueryResultRow & {
  local_user_id: string;
  email: string;
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
    const normalized = normalizeIdentifier(identifier);
    const result = await applicationQuery<UserRow>(
      "select * from app_users where email = $1 or username = $1 limit 1",
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
      clauses.push(`(email like $${values.length - 1} or username like $${values.length - 1} or local_user_id = $${values.length})`);
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
    const username = normalizeUsername(input.username);
    const timestamp = nowIso(input.now);
    try {
      const result = await applicationQuery<UserRow>(`
        insert into app_users(
          local_user_id, email, username, display_name, password_hash, status, role,
          session_version, created_at, updated_at, last_login_at
        ) values ($1,$2,$3,$4,$5,$6,$7,1,$8,$8,null)
        returning *
      `, [
        input.localUserId || randomUUID(),
        email,
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
    patch: Partial<Pick<AuthUser, "status" | "last_login_at" | "session_version" | "display_name">>,
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
