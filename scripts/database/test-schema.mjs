#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

const { Pool } = pg;

function requireDatabaseUrl() {
  const value = process.env.APP_DATABASE_URL || "";
  if (!value) throw new Error("APP_DATABASE_URL is required.");
  if (!/^postgres(?:ql)?:\/\//i.test(value)) throw new Error("APP_DATABASE_URL must be PostgreSQL.");
  return value;
}

function requireExpectedDatabaseName() {
  const value = process.env.APP_DATABASE_EXPECTED_NAME || "";
  if (!value) throw new Error("APP_DATABASE_EXPECTED_NAME is required.");
  return value;
}

const pool = new Pool({
  connectionString: requireDatabaseUrl(),
  max: 3,
  connectionTimeoutMillis: 5000,
  statement_timeout: 10000,
  query_timeout: 10000,
  application_name: "aohuang_app_schema_tests",
});

async function q(text, values = []) {
  return pool.query(text, values);
}

async function assertDatabaseIdentity() {
  const result = await q("select current_database() as database_name");
  assert.equal(result.rows[0].database_name, requireExpectedDatabaseName());
}

async function expectRejects(name, fn) {
  let rejected = false;
  try {
    await fn();
  } catch {
    rejected = true;
  }
  assert.equal(rejected, true, `${name} should reject`);
}

async function reset() {
  await q("truncate table audit_events, task_billing_records, usage_records, billing_idempotency_keys, billing_webhook_events, billing_orders, new_api_user_mappings, auth_sessions, app_users restart identity cascade");
}

async function seedUser(overrides = {}) {
  const id = overrides.local_user_id || randomUUID();
  await q(`
    insert into app_users(
      local_user_id, email, username, display_name, password_hash, status, role,
      session_version, created_at, updated_at
    ) values ($1,$2,$3,$4,$5,$6,$7,1,now(),now())
  `, [
    id,
    overrides.email || `${id}@example.com`,
    overrides.username || `user_${id.slice(0, 8)}`,
    "Test User",
    "scrypt$v=1$n=16384$r=8$p=1$len=64$c2FsdA$0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    overrides.status || "active",
    overrides.role || "user",
  ]);
  return id;
}

async function assertTablesAndIndexes() {
  const tables = await q(`
    select table_name from information_schema.tables
    where table_schema = 'public'
      and table_name = any($1)
  `, [[
    "app_users",
    "auth_sessions",
    "new_api_user_mappings",
    "billing_orders",
    "billing_webhook_events",
    "billing_idempotency_keys",
    "usage_records",
    "task_billing_records",
    "audit_events",
    "reconciliation_runs",
    "schema_migrations",
  ]]);
  assert.equal(tables.rowCount, 11);

  const indexes = await q(`
    select indexname from pg_indexes
    where schemaname = 'public'
      and indexname = any($1)
  `, [[
    "app_users_email_unique",
    "auth_sessions_token_hash_unique",
    "new_api_user_mappings_idempotency_unique",
    "billing_orders_provider_order_unique",
    "billing_webhook_events_pkey",
    "usage_records_idempotency_unique",
  ]]);
  assert.equal(indexes.rowCount, 6);
}

async function assertMigrationStatus() {
  const result = await q("select version, checksum from schema_migrations order by version");
  assert.deepEqual(result.rows.map((row) => row.version), [
    "001_initial_application_schema",
    "002_harden_database_baseline",
    "003_billing_webhook_processing_status",
  ]);
  for (const row of result.rows) {
    assert.match(row.checksum, /^[a-f0-9]{64}$/);
  }
}

async function assertConstraints() {
  const userId = await seedUser({ email: "unique@example.com", username: "unique_user" });
  await expectRejects("unique email", () => seedUser({ email: "unique@example.com", username: "other_user" }));

  await q(`
    insert into new_api_user_mappings(
      local_user_id, new_api_user_id, sync_status, created_at, updated_at, idempotency_key
    ) values ($1,'100','active',now(),now(),'map-key-1')
  `, [userId]);
  const secondUser = await seedUser({ email: "second@example.com", username: "second_user" });
  await expectRejects("unique new_api_user_id", () => q(`
    insert into new_api_user_mappings(
      local_user_id, new_api_user_id, sync_status, created_at, updated_at, idempotency_key
    ) values ($1,'100','active',now(),now(),'map-key-2')
  `, [secondUser]));

  await q(`
    insert into billing_orders(
      order_id, local_user_id, new_api_user_id, channel, currency, requested_amount,
      paid_amount, credited_quota, status, idempotency_key, provider_order_id,
      created_at, updated_at
    ) values ('bo_test',$1,'100','sandbox_alipay','CNY',1000,0,1000,'pending','idem-order','sandbox_bo_test',now(),now())
  `, [userId]);
  await expectRejects("order amount integer/minor units", () => q(`
    insert into billing_orders(
      order_id, local_user_id, new_api_user_id, channel, currency, requested_amount,
      paid_amount, credited_quota, status, idempotency_key, provider_order_id,
      created_at, updated_at
    ) values ('bo_bad',$1,'100','sandbox_alipay','CNY',-1,0,1000,'pending','idem-bad','sandbox_bo_bad',now(),now())
  `, [userId]));
  await expectRejects("invalid order status", () => q(`
    update billing_orders set status = 'unknown' where order_id = 'bo_test'
  `));

  await q(`
    insert into billing_webhook_events(event_id, order_id, provider_order_id, event_type, payload_hash, status)
    values ('evt_1','bo_test','sandbox_bo_test','payment_succeeded','hash','received')
  `);
  await expectRejects("unique webhook event", () => q(`
    insert into billing_webhook_events(event_id, order_id, provider_order_id, event_type, payload_hash, status)
    values ('evt_1','bo_test','sandbox_bo_test','payment_succeeded','hash','received')
  `));
  await expectRejects("legacy webhook event status is rejected", () => q(`
    insert into billing_webhook_events(event_id, order_id, provider_order_id, event_type, payload_hash, status)
    values ('evt_legacy','bo_test','sandbox_bo_test','payment_succeeded','hash','accepted')
  `));

  await q(`
    insert into billing_idempotency_keys(key_id, local_user_id, idempotency_key, scope, order_id, created_at)
    values ($1,$2,'idem-order','billing_order','bo_test',now())
  `, [randomUUID(), userId]);
  await expectRejects("unique idempotency key", () => q(`
    insert into billing_idempotency_keys(key_id, local_user_id, idempotency_key, scope, order_id, created_at)
    values ($1,$2,'idem-order','billing_order','bo_test',now())
  `, [randomUUID(), userId]));

  const validSessionHash = "a".repeat(64);
  await q(`
    insert into auth_sessions(
      session_id, local_user_id, token_hash, session_version, created_at, updated_at,
      last_seen_at, idle_expires_at, expires_at
    ) values ($1,$2,$3,1,now(),now(),now(),now() + interval '1 hour',now() + interval '2 hours')
  `, [randomUUID(), userId, validSessionHash]);
  const expired = await q("select count(*)::int as count from auth_sessions where idle_expires_at < now()");
  assert.equal(expired.rows[0].count, 0);
  await expectRejects("raw base64url session token is rejected", () => q(`
    insert into auth_sessions(
      session_id, local_user_id, token_hash, session_version, created_at, updated_at,
      last_seen_at, idle_expires_at, expires_at
    ) values ($1,$2,'rawBase64urlSessionToken_1234567890abcdef',1,now(),now(),now(),now() + interval '1 hour',now() + interval '2 hours')
  `, [randomUUID(), userId]));
  await expectRejects("short session token hash is rejected", () => q(`
    insert into auth_sessions(
      session_id, local_user_id, token_hash, session_version, created_at, updated_at,
      last_seen_at, idle_expires_at, expires_at
    ) values ($1,$2,'short',1,now(),now(),now(),now() + interval '1 hour',now() + interval '2 hours')
  `, [randomUUID(), userId]));
  await expectRejects("non hex 64 character session token hash is rejected", () => q(`
    insert into auth_sessions(
      session_id, local_user_id, token_hash, session_version, created_at, updated_at,
      last_seen_at, idle_expires_at, expires_at
    ) values ($1,$2,$3,1,now(),now(),now(),now() + interval '1 hour',now() + interval '2 hours')
  `, [randomUUID(), userId, "g".repeat(64)]));
  await expectRejects("duplicate session token hash is rejected", () => q(`
    insert into auth_sessions(
      session_id, local_user_id, token_hash, session_version, created_at, updated_at,
      last_seen_at, idle_expires_at, expires_at
    ) values ($1,$2,$3,1,now(),now(),now(),now() + interval '1 hour',now() + interval '2 hours')
  `, [randomUUID(), userId, validSessionHash]));

  await q(`
    insert into usage_records(
      id, local_user_id, new_api_user_id, task_id, operation, status, estimated_quota_units,
      actual_quota_units, created_at, updated_at, idempotency_key
    ) values ($1,$2,'100','task-1','cloud_image_generation','prechecked',10,null,now(),now(),'usage-idem-1')
  `, [randomUUID(), userId]);
  await expectRejects("usage foreign key", () => q(`
    insert into usage_records(
      id, local_user_id, task_id, operation, status, estimated_quota_units,
      created_at, updated_at, idempotency_key
    ) values ($1,$2,'task-orphan','cloud_image_generation','prechecked',10,now(),now(),'usage-orphan')
  `, [randomUUID(), randomUUID()]));
}

async function assertRollbackAndHealth() {
  const before = await q("select count(*)::int as count from app_users");
  const rollbackEmail = "rollback@example.com";
  const client = await pool.connect();
  await expectRejects("transaction rollback", async () => {
    await client.query("begin");
    try {
      await client.query(`
        insert into app_users(
          local_user_id, email, username, display_name, password_hash, status, role,
          session_version, created_at, updated_at
        ) values ($1,$2,'rollback_user','Rollback User',$3,'active','user',1,now(),now())
      `, [
        randomUUID(),
        rollbackEmail,
        "scrypt$v=1$n=16384$r=8$p=1$len=64$c2FsdA$0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      ]);
      const inside = await client.query("select count(*)::int as count from app_users where email = $1", [rollbackEmail]);
      assert.equal(inside.rows[0].count, 1);
      await client.query("insert into app_users(local_user_id,email,username,display_name,password_hash,status,role,created_at,updated_at) values ($1,'bad@example.com','bad','Bad','plain','invalid','user',now(),now())", [randomUUID()]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  }).finally(() => {
    client.release();
  });
  const after = await q("select count(*)::int as count from app_users");
  assert.equal(after.rows[0].count, before.rows[0].count);
  const rollbackUser = await q("select count(*)::int as count from app_users where email = $1", [rollbackEmail]);
  assert.equal(rollbackUser.rows[0].count, 0);

  const health = await q("select current_database() as database_name");
  assert.ok(health.rows[0].database_name);
}

async function main() {
  await assertDatabaseIdentity();
  await assertTablesAndIndexes();
  await assertMigrationStatus();
  await reset();
  await assertConstraints();
  await assertRollbackAndHealth();
  console.log("database schema tests passed");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "database schema tests failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
