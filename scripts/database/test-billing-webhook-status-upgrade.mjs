#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
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

async function assertDatabaseIdentity(pool) {
  const result = await pool.query("select current_database() as database_name");
  assert.equal(result.rows[0]?.database_name, requireExpectedDatabaseName());
}

function runMigration(target = "") {
  const env = { ...process.env };
  if (target) env.APP_DATABASE_MIGRATION_TARGET = target;
  else delete env.APP_DATABASE_MIGRATION_TARGET;
  const result = spawnSync("node", ["scripts/database/migrate.mjs", "up"], {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  assert.equal(result.status, 0, `migration ${target || "all"} should succeed`);
}

async function resetSchema(pool) {
  await pool.query("drop schema if exists public cascade");
  await pool.query("create schema public");
}

async function seedLegacyWebhookEvents(pool) {
  const userId = randomUUID();
  await pool.query(`
    insert into app_users(
      local_user_id, email, username, display_name, password_hash, status, role,
      session_version, created_at, updated_at
    ) values ($1,'legacy-webhook@example.com','legacy_webhook','Legacy Webhook',$2,'active','user',1,now(),now())
  `, [
    userId,
    "scrypt$v=1$n=16384$r=8$p=1$len=64$c2FsdA$0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  ]);
  await pool.query(`
    insert into billing_orders(
      order_id, local_user_id, new_api_user_id, channel, currency, requested_amount,
      paid_amount, credited_quota, status, idempotency_key, provider_order_id,
      created_at, updated_at
    ) values ('bo_legacy_webhook',$1,'9001','sandbox_alipay','CNY',1000,0,1000,'pending','idem-legacy-webhook','sandbox_bo_legacy_webhook',now(),now())
  `, [userId]);

  const statuses = ["accepted", "duplicate", "rejected", "review"];
  for (const status of statuses) {
    await pool.query(`
      insert into billing_webhook_events(event_id, order_id, provider_order_id, event_type, payload_hash, status)
      values ($1,'bo_legacy_webhook','sandbox_bo_legacy_webhook','payment_succeeded',$2,$3)
    `, [`evt_legacy_${status}`, `hash-${status}`, status]);
  }
}

async function assertConverted(pool) {
  const result = await pool.query(`
    select event_id, status
    from billing_webhook_events
    order by event_id asc
  `);
  const statuses = Object.fromEntries(result.rows.map((row) => [row.event_id, row.status]));
  assert.equal(statuses.evt_legacy_accepted, "completed");
  assert.equal(statuses.evt_legacy_duplicate, "completed");
  assert.equal(statuses.evt_legacy_rejected, "failed");
  assert.equal(statuses.evt_legacy_review, "failed");

  for (const status of ["accepted", "duplicate", "rejected", "review"]) {
    await assert.rejects(() => pool.query(`
      insert into billing_webhook_events(event_id, order_id, provider_order_id, event_type, payload_hash, status)
      values ($1,'bo_legacy_webhook','sandbox_bo_legacy_webhook','payment_succeeded',$2,$3)
    `, [`evt_legacy_after_003_${status}`, `hash-after-${status}`, status]));
  }
}

async function main() {
  const pool = new Pool({
    connectionString: requireDatabaseUrl(),
    max: 2,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
    query_timeout: 10000,
    application_name: "aohuang_app_billing_webhook_status_upgrade_test",
  });
  try {
    await assertDatabaseIdentity(pool);
    await resetSchema(pool);
    runMigration("002_harden_database_baseline");
    await seedLegacyWebhookEvents(pool);
    runMigration();
    await assertConverted(pool);
    console.log("billing webhook status upgrade test passed");
  } finally {
    await resetSchema(pool).catch(() => undefined);
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "billing webhook status upgrade test failed");
  process.exit(1);
});
