#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

const { Pool } = pg;
const root = process.cwd();
const command = process.argv[2] || "dry-run";
const applyConfirmed = process.argv.includes("--confirm-apply");
const dataDir = process.env.APP_AUTH_MIGRATION_DATA_DIR || join(root, "data");
const authStorePath = process.env.APP_AUTH_STORE_PATH || join(dataDir, "auth-store.json");
const mappingStorePath = process.env.APP_NEW_API_MAPPING_STORE_PATH || join(dataDir, "new-api-user-mappings.json");
const sessionHashPattern = /^[a-f0-9]{64}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const userStatuses = new Set(["active", "disabled", "verification_required"]);
const userRoles = new Set(["user", "admin"]);
const mappingStatuses = new Set(["pending", "active", "failed", "disabled", "orphaned", "repair_required"]);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function redactId(value) {
  const text = String(value || "");
  if (!text) return "";
  return text.length <= 8 ? "[REDACTED]" : `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function sourceHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

function requireDatabaseUrl() {
  const value = process.env.APP_DATABASE_URL || "";
  if (!value) fail("APP_DATABASE_URL is required.");
  if (!/^postgres(?:ql)?:\/\//i.test(value)) fail("APP_DATABASE_URL must be a PostgreSQL connection string.");
  return value;
}

function requireExpectedDatabaseName() {
  const value = process.env.APP_DATABASE_EXPECTED_NAME || "";
  if (!value) fail("APP_DATABASE_EXPECTED_NAME is required.");
  return value;
}

async function assertDatabaseIdentity(client) {
  const expected = requireExpectedDatabaseName();
  const result = await client.query("select current_database() as database_name");
  const actual = result.rows[0]?.database_name || "";
  if (actual !== expected) fail(`Connected to unexpected application database "${actual}".`);
}

function normalizeAuthStore(value) {
  return {
    users: Array.isArray(value?.users) ? value.users : [],
    sessions: Array.isArray(value?.sessions) ? value.sessions : [],
    audit: Array.isArray(value?.audit) ? value.audit : [],
  };
}

function normalizeMappings(value) {
  return Array.isArray(value) ? value : [];
}

function isIsoDate(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function validate(authStore, mappings) {
  const issues = [];
  const seenUsers = new Set();
  const seenEmails = new Set();
  const seenUsernames = new Set();
  const seenSessionHashes = new Set();
  const seenNewApiUsers = new Set();
  const seenMappingKeys = new Set();

  for (const user of authStore.users) {
    const id = String(user?.local_user_id || "");
    if (!uuidPattern.test(id)) issues.push({ code: "invalid_user_id", id: redactId(id) });
    if (seenUsers.has(id)) issues.push({ code: "duplicate_user_id", id: redactId(id) });
    seenUsers.add(id);
    const email = String(user?.email || "").trim().toLowerCase();
    const username = String(user?.username || "").trim().toLowerCase();
    if (!email || seenEmails.has(email)) issues.push({ code: "duplicate_or_missing_email", id: redactId(id) });
    if (!username || seenUsernames.has(username)) issues.push({ code: "duplicate_or_missing_username", id: redactId(id) });
    seenEmails.add(email);
    seenUsernames.add(username);
    if (!String(user?.password_hash || "").startsWith("scrypt$")) issues.push({ code: "invalid_password_hash", id: redactId(id) });
    if (!userStatuses.has(user?.status)) issues.push({ code: "invalid_user_status", id: redactId(id) });
    if (!userRoles.has(user?.role)) issues.push({ code: "invalid_user_role", id: redactId(id) });
    for (const key of ["created_at", "updated_at"]) {
      if (!isIsoDate(user?.[key])) issues.push({ code: `invalid_user_${key}`, id: redactId(id) });
    }
    if (user?.last_login_at !== null && user?.last_login_at !== undefined && !isIsoDate(user.last_login_at)) {
      issues.push({ code: "invalid_user_last_login_at", id: redactId(id) });
    }
  }

  for (const session of authStore.sessions) {
    const id = String(session?.session_id || "");
    const owner = String(session?.local_user_id || "");
    const tokenHash = String(session?.token_hash || "");
    if (!uuidPattern.test(id)) issues.push({ code: "invalid_session_id", id: redactId(id) });
    if (!seenUsers.has(owner)) issues.push({ code: "orphan_session", id: redactId(id), owner: redactId(owner) });
    if (!sessionHashPattern.test(tokenHash)) issues.push({ code: "invalid_token_hash", id: redactId(id) });
    if (seenSessionHashes.has(tokenHash)) issues.push({ code: "duplicate_token_hash", id: redactId(id) });
    seenSessionHashes.add(tokenHash);
    for (const key of ["created_at", "updated_at", "last_seen_at", "idle_expires_at", "expires_at"]) {
      if (!isIsoDate(session?.[key])) issues.push({ code: `invalid_session_${key}`, id: redactId(id) });
    }
    if (session?.revoked_at !== null && session?.revoked_at !== undefined && !isIsoDate(session.revoked_at)) {
      issues.push({ code: "invalid_session_revoked_at", id: redactId(id) });
    }
  }

  for (const mapping of mappings) {
    const owner = String(mapping?.local_user_id || "");
    const newApiUserId = mapping?.new_api_user_id === null || mapping?.new_api_user_id === undefined
      ? null
      : String(mapping.new_api_user_id);
    if (!seenUsers.has(owner)) issues.push({ code: "orphan_mapping", id: redactId(owner) });
    if (!mappingStatuses.has(mapping?.sync_status)) issues.push({ code: "invalid_mapping_status", id: redactId(owner) });
    if (mapping?.sync_status === "active" && !newApiUserId) issues.push({ code: "active_mapping_missing_new_api_user", id: redactId(owner) });
    if (newApiUserId) {
      if (seenNewApiUsers.has(newApiUserId)) issues.push({ code: "duplicate_new_api_user_id", id: redactId(owner) });
      seenNewApiUsers.add(newApiUserId);
    }
    const idempotencyKey = String(mapping?.idempotency_key || "");
    if (!idempotencyKey || seenMappingKeys.has(idempotencyKey)) issues.push({ code: "duplicate_or_missing_mapping_idempotency_key", id: redactId(owner) });
    seenMappingKeys.add(idempotencyKey);
    for (const key of ["created_at", "updated_at"]) {
      if (!isIsoDate(mapping?.[key])) issues.push({ code: `invalid_mapping_${key}`, id: redactId(owner) });
    }
    if (mapping?.last_sync_at !== null && mapping?.last_sync_at !== undefined && !isIsoDate(mapping.last_sync_at)) {
      issues.push({ code: "invalid_mapping_last_sync_at", id: redactId(owner) });
    }
  }

  return issues;
}

async function loadSource() {
  const authStore = normalizeAuthStore(await readJson(authStorePath, null));
  const mappings = normalizeMappings(await readJson(mappingStorePath, []));
  return { authStore, mappings };
}

function summary(authStore, mappings, issues = []) {
  return {
    users: authStore.users.length,
    sessions: authStore.sessions.length,
    authAuditEvents: authStore.audit.length,
    mappings: mappings.length,
    issues: issues.length,
    sourceHash: sourceHash({
      users: authStore.users.map((user) => user.local_user_id).sort(),
      sessions: authStore.sessions.map((session) => session.session_id).sort(),
      mappings: mappings.map((mapping) => mapping.local_user_id).sort(),
    }),
    issueCodes: [...new Set(issues.map((issue) => issue.code))].sort(),
  };
}

async function insertAuthData(client, authStore, mappings) {
  for (const user of authStore.users) {
    await client.query(`
      insert into app_users(
        local_user_id, email, username, display_name, password_hash, status, role,
        session_version, created_at, updated_at, last_login_at
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      on conflict (local_user_id) do update
      set email = excluded.email,
          username = excluded.username,
          display_name = excluded.display_name,
          password_hash = excluded.password_hash,
          status = excluded.status,
          role = excluded.role,
          session_version = excluded.session_version,
          updated_at = excluded.updated_at,
          last_login_at = excluded.last_login_at
    `, [
      user.local_user_id,
      user.email,
      user.username,
      user.display_name,
      user.password_hash,
      user.status,
      user.role,
      user.session_version,
      user.created_at,
      user.updated_at,
      user.last_login_at,
    ]);
  }

  for (const session of authStore.sessions) {
    await client.query(`
      insert into auth_sessions(
        session_id, local_user_id, token_hash, session_version, created_at, updated_at,
        last_seen_at, idle_expires_at, expires_at, revoked_at, user_agent_hash, ip_hash
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      on conflict (session_id) do update
      set token_hash = excluded.token_hash,
          session_version = excluded.session_version,
          updated_at = excluded.updated_at,
          last_seen_at = excluded.last_seen_at,
          idle_expires_at = excluded.idle_expires_at,
          expires_at = excluded.expires_at,
          revoked_at = excluded.revoked_at,
          user_agent_hash = excluded.user_agent_hash,
          ip_hash = excluded.ip_hash
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
  }

  for (const mapping of mappings) {
    await client.query(`
      insert into new_api_user_mappings(
        local_user_id, new_api_user_id, sync_status, created_at, updated_at,
        last_sync_at, last_error_code, last_error_message, retry_count, version, idempotency_key
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      on conflict (local_user_id) do update
      set new_api_user_id = excluded.new_api_user_id,
          sync_status = excluded.sync_status,
          updated_at = excluded.updated_at,
          last_sync_at = excluded.last_sync_at,
          last_error_code = excluded.last_error_code,
          last_error_message = excluded.last_error_message,
          retry_count = excluded.retry_count,
          version = excluded.version,
          idempotency_key = excluded.idempotency_key
    `, [
      mapping.local_user_id,
      mapping.new_api_user_id,
      mapping.sync_status,
      mapping.created_at,
      mapping.updated_at,
      mapping.last_sync_at,
      mapping.last_error_code,
      mapping.last_error_message,
      mapping.retry_count,
      mapping.version,
      mapping.idempotency_key,
    ]);
  }

  for (const event of authStore.audit) {
    await client.query(`
      insert into audit_events(
        id, event, local_user_id, created_at, request_id, ip_hash, user_agent_hash, safe_details
      ) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
      on conflict (id) do nothing
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
}

async function databaseCounts(client) {
  const result = await client.query(`
    select
      (select count(*)::int from app_users) as users,
      (select count(*)::int from auth_sessions) as sessions,
      (select count(*)::int from new_api_user_mappings) as mappings,
      (select count(*)::int from audit_events where event like 'auth.%') as auth_audit_events
  `);
  return result.rows[0];
}

async function main() {
  if (!["dry-run", "apply", "verify"].includes(command)) {
    fail("Usage: node scripts/database/auth-data-migration.mjs [dry-run|apply|verify] [--confirm-apply]");
  }

  const { authStore, mappings } = await loadSource();
  const issues = validate(authStore, mappings);
  if (command === "dry-run") {
    console.log(JSON.stringify({ ok: issues.length === 0, mode: "dry-run", ...summary(authStore, mappings, issues) }));
    if (issues.length > 0) process.exitCode = 2;
    return;
  }

  if (issues.length > 0) {
    console.error(JSON.stringify({ ok: false, mode: command, ...summary(authStore, mappings, issues), issues: issues.slice(0, 20) }));
    process.exit(2);
  }

  if (command === "apply" && !applyConfirmed) {
    fail("apply requires --confirm-apply.");
  }

  const pool = new Pool({
    connectionString: requireDatabaseUrl(),
    max: Number(process.env.APP_DATABASE_MAX_CONNECTIONS || 3),
    connectionTimeoutMillis: Number(process.env.APP_DATABASE_CONNECT_TIMEOUT_MS || 5000),
    idleTimeoutMillis: Number(process.env.APP_DATABASE_IDLE_TIMEOUT_MS || 5000),
    statement_timeout: Number(process.env.APP_DATABASE_QUERY_TIMEOUT_MS || 10000),
    query_timeout: Number(process.env.APP_DATABASE_QUERY_TIMEOUT_MS || 10000),
    application_name: "aohuang_auth_data_migration",
  });

  const client = await pool.connect();
  try {
    await assertDatabaseIdentity(client);
    if (command === "apply") {
      await client.query("begin");
      try {
        await insertAuthData(client, authStore, mappings);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      }
    }
    const counts = await databaseCounts(client);
    console.log(JSON.stringify({
      ok: true,
      mode: command,
      ...summary(authStore, mappings, []),
      database: counts,
    }));
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "auth data migration failed");
  process.exit(1);
});
