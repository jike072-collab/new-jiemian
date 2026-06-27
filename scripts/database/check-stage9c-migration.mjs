#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const migrationPath = join(root, "db", "migrations", "007_database_mvp_foundation.sql");
const databaseUrl = process.env.STAGE9C_TEST_DATABASE_URL || "";
const expectedName = process.env.STAGE9C_TEST_DATABASE_EXPECTED_NAME || "";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseDatabaseName(value) {
  try {
    const url = new URL(value);
    return decodeURIComponent(url.pathname.replace(/^\//, ""));
  } catch {
    return "";
  }
}

function assertSafeTestDatabase() {
  if (!databaseUrl || !expectedName) {
    return {
      mode: "static_only",
      reason: "STAGE9C_TEST_DATABASE_URL or STAGE9C_TEST_DATABASE_EXPECTED_NAME is missing",
    };
  }
  if (!/^postgres(?:ql)?:\/\//i.test(databaseUrl)) {
    fail("STAGE9C_TEST_DATABASE_URL must be a PostgreSQL connection string.");
  }
  const actualName = parseDatabaseName(databaseUrl);
  if (actualName !== expectedName) {
    fail("Stage 9C-A test database name does not match the explicit expected name.");
  }
  if (!/(test|tmp|temp|stage9c|ci|rollback_drill)/i.test(expectedName)) {
    fail("Stage 9C-A refuses to run migrations unless the expected database name is clearly test-only.");
  }
  if (/(prod|production|staging|3106|3107|newapi)/i.test(expectedName)) {
    fail("Stage 9C-A refuses production, staging, service-port, or NewAPI database names.");
  }
  return { mode: "temporary_test_database", database: "configured/masked" };
}

function runNode(args, env = process.env) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) fail(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!existsSync(migrationPath)) fail("Stage 9C-A migration file is missing.");

runNode(["scripts/database/check-stage9c-schema.mjs"]);
const safety = assertSafeTestDatabase();

if (safety.mode === "temporary_test_database") {
  runNode(["scripts/database/migrate.mjs", "up"], {
    ...process.env,
    APP_DATABASE_URL: databaseUrl,
    APP_DATABASE_EXPECTED_NAME: expectedName,
    APP_DATABASE_MIGRATION_TARGET: "007_database_mvp_foundation",
  });
  runNode(["scripts/database/migrate.mjs", "status"], {
    ...process.env,
    APP_DATABASE_URL: databaseUrl,
    APP_DATABASE_EXPECTED_NAME: expectedName,
    APP_DATABASE_MIGRATION_TARGET: "007_database_mvp_foundation",
  });
}

console.log(JSON.stringify({
  ok: true,
  mode: safety.mode,
  database: safety.database || "missing",
  productionMigration: false,
  stagingMigration: false,
  productionDbWritten: false,
  stagingDbWritten: false,
  secrets: "masked",
}, null, 2));
