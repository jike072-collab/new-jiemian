#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const root = fileURLToPath(new URL("../..", import.meta.url));
const migrationsDir = join(root, "db", "migrations");
const command = process.argv[2] || "up";

function fail(message) {
  console.error(message);
  process.exit(1);
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
  if (!/^[a-zA-Z0-9_][a-zA-Z0-9_-]{0,62}$/.test(value)) {
    fail("APP_DATABASE_EXPECTED_NAME must be a valid explicit database name.");
  }
  return value;
}

async function assertDatabaseIdentity(client) {
  const expected = requireExpectedDatabaseName();
  const result = await client.query("select current_database() as database_name");
  const actual = result.rows[0]?.database_name || "";
  if (actual !== expected) {
    fail(`Connected to unexpected application database "${actual}". Expected "${expected}".`);
  }
  return actual;
}

function checksum(sql) {
  return createHash("sha256").update(sql).digest("hex");
}

function migrationVersion(file) {
  return basename(file, ".sql");
}

async function loadMigrations() {
  const files = (await readdir(migrationsDir))
    .filter((file) => /^\d+_[a-z0-9_]+\.sql$/i.test(file))
    .sort();
  const target = process.env.APP_DATABASE_MIGRATION_TARGET || "";
  const selected = target ? files.filter((file) => migrationVersion(file) <= target) : files;
  return Promise.all(selected.map(async (file) => {
    const sql = await readFile(join(migrationsDir, file), "utf8");
    return {
      file,
      version: migrationVersion(file),
      checksum: checksum(sql),
      sql,
    };
  }));
}

async function ensureMigrationTable(client) {
  await assertDatabaseIdentity(client);
  await client.query(`
    create table if not exists schema_migrations (
      version text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )
  `);
}

async function appliedMigrations(client) {
  await ensureMigrationTable(client);
  const result = await client.query("select version, checksum, applied_at from schema_migrations order by version");
  return new Map(result.rows.map((row) => [row.version, row]));
}

async function migrate(pool) {
  const migrations = await loadMigrations();
  const client = await pool.connect();
  try {
    await assertDatabaseIdentity(client);
    const applied = await appliedMigrations(client);
    for (const migration of migrations) {
      const existing = applied.get(migration.version);
      if (existing) {
        if (existing.checksum !== migration.checksum) {
          fail(`checksum mismatch for already-applied migration ${migration.version}`);
        }
        continue;
      }
      await client.query("begin");
      try {
        await client.query(migration.sql);
        await client.query(
          "insert into schema_migrations(version, checksum) values ($1, $2)",
          [migration.version, migration.checksum],
        );
        await client.query("commit");
        console.log(`applied ${migration.version}`);
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      }
    }
  } finally {
    client.release();
  }
}

async function status(pool) {
  const migrations = await loadMigrations();
  const client = await pool.connect();
  try {
    await assertDatabaseIdentity(client);
    const applied = await appliedMigrations(client);
    let pending = 0;
    for (const migration of migrations) {
      const existing = applied.get(migration.version);
      if (!existing) {
        pending += 1;
        console.log(`${migration.version}\tpending`);
      } else if (existing.checksum !== migration.checksum) {
        console.log(`${migration.version}\tchecksum_mismatch`);
        pending += 1;
      } else {
        console.log(`${migration.version}\tapplied`);
      }
    }
    if (pending > 0) process.exitCode = 2;
  } finally {
    client.release();
  }
}

async function health(pool) {
  const client = await pool.connect();
  try {
    await assertDatabaseIdentity(client);
    const result = await client.query("select now()::text as server_time, current_database() as database_name");
    const migrationTable = await client.query("select to_regclass('public.schema_migrations') as table_name");
    const migrations = migrationTable.rows[0]?.table_name
      ? await client.query("select count(*)::int as count from schema_migrations")
      : { rows: [{ count: 0 }] };
    console.log(JSON.stringify({
      ok: true,
      database: result.rows[0].database_name,
      serverTime: result.rows[0].server_time,
      migrationCount: migrations.rows[0].count,
    }));
  } finally {
    client.release();
  }
}

async function main() {
  if (!["up", "status", "health"].includes(command)) {
    fail("Usage: node scripts/database/migrate.mjs [up|status|health]");
  }
  const pool = new Pool({
    connectionString: requireDatabaseUrl(),
    max: Number(process.env.APP_DATABASE_MAX_CONNECTIONS || 3),
    connectionTimeoutMillis: Number(process.env.APP_DATABASE_CONNECT_TIMEOUT_MS || 5000),
    idleTimeoutMillis: Number(process.env.APP_DATABASE_IDLE_TIMEOUT_MS || 5000),
    statement_timeout: Number(process.env.APP_DATABASE_QUERY_TIMEOUT_MS || 10000),
    query_timeout: Number(process.env.APP_DATABASE_QUERY_TIMEOUT_MS || 10000),
    application_name: "aohuang_app_migrations",
  });
  try {
    if (command === "up") await migrate(pool);
    if (command === "status") await status(pool);
    if (command === "health") await health(pool);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "migration failed");
  process.exit(1);
});
