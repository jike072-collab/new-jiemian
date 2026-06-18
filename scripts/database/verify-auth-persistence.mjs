#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

const { Pool } = pg;
const root = process.cwd();
const dataDir = process.env.APP_AUTH_MIGRATION_DATA_DIR || join(root, "data");
const authStorePath = process.env.APP_AUTH_STORE_PATH || join(dataDir, "auth-store.json");
const mappingStorePath = process.env.APP_NEW_API_MAPPING_STORE_PATH || join(dataDir, "new-api-user-mappings.json");

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

async function main() {
  const authStore = normalizeAuthStore(await readJson(authStorePath, null));
  const mappings = normalizeMappings(await readJson(mappingStorePath, []));
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
    const result = await client.query(`
      select
        array(select local_user_id::text from app_users order by local_user_id::text) as user_ids,
        array(select session_id::text from auth_sessions order by session_id::text) as session_ids,
        array(select local_user_id::text from new_api_user_mappings order by local_user_id::text) as mapping_ids,
        (select count(*)::int from audit_events where event like 'auth.%') as auth_audit_events
    `);
    const database = result.rows[0];
    const summary = {
      ok: true,
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
    };
    summary.ok = summary.json.users === summary.postgres.users
      && summary.json.sessions === summary.postgres.sessions
      && summary.json.mappings === summary.postgres.mappings
      && summary.json.userHash === summary.postgres.userHash
      && summary.json.sessionHash === summary.postgres.sessionHash
      && summary.json.mappingHash === summary.postgres.mappingHash;
    console.log(JSON.stringify(summary));
    if (!summary.ok) process.exitCode = 2;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "auth persistence verification failed");
  process.exit(1);
});
