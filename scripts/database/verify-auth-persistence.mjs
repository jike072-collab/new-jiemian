#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import pg from "pg";

const { Pool } = pg;
const root = process.cwd();
const shouldRepair = process.argv.includes("--repair");
const dataDir = process.env.APP_AUTH_MIGRATION_DATA_DIR || join(root, "data");
const authStorePath = process.env.APP_AUTH_STORE_PATH || join(dataDir, "auth-store.json");
const mappingStorePath = process.env.APP_NEW_API_MAPPING_STORE_PATH || join(dataDir, "new-api-user-mappings.json");
const repairStorePath = process.env.APP_AUTH_DUAL_REPAIR_STORE_PATH || join(dataDir, "auth-dual-repair-records.json");

function redact(value) {
  return String(value || "")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-[REDACTED]")
    .replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, "postgresql://[REDACTED]")
    .replace(/(password|secret|token|cookie|authorization|api[_-]?key)=([^&\s]+)/gi, "$1=[REDACTED]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, "[REDACTED_HOST]");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

function hashIds(values) {
  return createHash("sha256").update(values.map(String).sort().join("\n")).digest("hex");
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

function normalizeRepairRecords(value) {
  return Array.isArray(value) ? value.filter((record) => record && typeof record === "object") : [];
}

function repairSummary(records) {
  return {
    total: records.length,
    pending: records.filter((record) => record.status === "pending").length,
    failed: records.filter((record) => record.status === "failed").length,
    repaired: records.filter((record) => record.status === "repaired").length,
  };
}

async function updateRepairRecords(records, status, error = null) {
  const timestamp = new Date().toISOString();
  const next = records.map((record) => {
    if (record.status !== "pending" && record.status !== "failed") return record;
    return {
      ...record,
      status,
      updated_at: timestamp,
      last_attempt_at: timestamp,
      retry_count: Number(record.retry_count || 0) + 1,
      last_error_code: error ? "AUTH_DUAL_REPAIR_FAILED" : null,
      last_error_message: error ? redact(error instanceof Error ? error.message : String(error)).slice(0, 300) : null,
    };
  });
  await writeJson(repairStorePath, next);
  return next;
}

function requireDatabaseUrl() {
  const value = process.env.APP_DATABASE_URL || "";
  if (!value) fail("APP_DATABASE_URL is required.");
  return value;
}

async function assertDatabaseIdentity(client) {
  const expected = process.env.APP_DATABASE_EXPECTED_NAME || "";
  if (!expected) fail("APP_DATABASE_EXPECTED_NAME is required.");
  const result = await client.query("select current_database() as database_name");
  const actual = result.rows[0]?.database_name || "";
  if (actual !== expected) fail(`Connected to unexpected application database "${actual}".`);
}

async function replayJsonToPostgres(client, authStore, mappings) {
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

async function databaseSnapshot(client) {
  const result = await client.query(`
    select
      array(select local_user_id::text from app_users order by local_user_id::text) as user_ids,
      array(select session_id::text from auth_sessions order by session_id::text) as session_ids,
      array(select local_user_id::text from new_api_user_mappings order by local_user_id::text) as mapping_ids,
      (select count(*)::int from audit_events where event like 'auth.%') as auth_audit_events
  `);
  return result.rows[0];
}

function buildSummary(authStore, mappings, database, repairRecords) {
  const summary = {
    ok: true,
    mode: shouldRepair ? "verify-repair" : "verify",
    json: {
      users: authStore.users.length,
      sessions: authStore.sessions.length,
      mappings: mappings.length,
      authAuditEvents: authStore.audit.length,
      userHash: hashIds(authStore.users.map((user) => user.local_user_id)),
      sessionHash: hashIds(authStore.sessions.map((session) => session.session_id)),
      mappingHash: hashIds(mappings.map((mapping) => mapping.local_user_id)),
    },
    postgres: {
      users: database.user_ids.length,
      sessions: database.session_ids.length,
      mappings: database.mapping_ids.length,
      authAuditEvents: database.auth_audit_events,
      userHash: hashIds(database.user_ids),
      sessionHash: hashIds(database.session_ids),
      mappingHash: hashIds(database.mapping_ids),
    },
    repairRecords: repairSummary(repairRecords),
  };
  summary.ok = summary.json.users === summary.postgres.users
    && summary.json.sessions === summary.postgres.sessions
    && summary.json.mappings === summary.postgres.mappings
    && summary.json.userHash === summary.postgres.userHash
    && summary.json.sessionHash === summary.postgres.sessionHash
    && summary.json.mappingHash === summary.postgres.mappingHash
    && summary.repairRecords.pending === 0
    && summary.repairRecords.failed === 0;
  return summary;
}

async function main() {
  const authStore = normalizeAuthStore(await readJson(authStorePath, null));
  const mappings = normalizeMappings(await readJson(mappingStorePath, []));
  let repairRecords = normalizeRepairRecords(await readJson(repairStorePath, []));
  const pool = new Pool({
    connectionString: requireDatabaseUrl(),
    max: Number(process.env.APP_DATABASE_MAX_CONNECTIONS || 3),
    connectionTimeoutMillis: Number(process.env.APP_DATABASE_CONNECT_TIMEOUT_MS || 5000),
    idleTimeoutMillis: Number(process.env.APP_DATABASE_IDLE_TIMEOUT_MS || 5000),
    statement_timeout: Number(process.env.APP_DATABASE_QUERY_TIMEOUT_MS || 10000),
    query_timeout: Number(process.env.APP_DATABASE_QUERY_TIMEOUT_MS || 10000),
    application_name: "aohuang_auth_persistence_verify",
  });
  const client = await pool.connect();
  try {
    await assertDatabaseIdentity(client);
    if (shouldRepair && repairRecords.some((record) => record.status === "pending" || record.status === "failed")) {
      await client.query("begin");
      try {
        await replayJsonToPostgres(client, authStore, mappings);
        await client.query("commit");
        repairRecords = await updateRepairRecords(repairRecords, "repaired");
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        repairRecords = await updateRepairRecords(repairRecords, "failed", error);
        throw error;
      }
    }
    const database = await databaseSnapshot(client);
    const summary = buildSummary(authStore, mappings, database, repairRecords);
    console.log(JSON.stringify(summary));
    if (!summary.ok) process.exitCode = 2;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(redact(error instanceof Error ? error.message : "auth persistence verification failed"));
  process.exit(1);
});
