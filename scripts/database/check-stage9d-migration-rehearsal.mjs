#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, join } from "node:path";

const root = process.cwd();
const migrationsDir = join(root, "db", "migrations");
const rehearsalDatabaseUrl = String(process.env.STAGE9D_REHEARSAL_DATABASE_URL || "").trim();
const expectedDatabaseName = String(process.env.STAGE9D_REHEARSAL_EXPECTED_NAME || "").trim();

const destructiveChecks = [
  { label: "DROP", regex: /\bdrop\s+(table|database|schema|index|column|constraint)\b/ig },
  { label: "TRUNCATE", regex: /\btruncate\s+(table\s+)?/ig },
  { label: "ALTER_DROP", regex: /\balter\s+table\b[\s\S]{0,160}?\bdrop\b/ig },
  { label: "ALTER_RENAME", regex: /\balter\s+table\b[\s\S]{0,160}?\brename\b/ig },
  { label: "ALTER_TYPE", regex: /\balter\s+table\b[\s\S]{0,160}?\balter\s+column\b[\s\S]{0,80}?\btype\b/ig },
  { label: "ALTER_NOT_NULL", regex: /\balter\s+table\b[\s\S]{0,160}?\balter\s+column\b[\s\S]{0,80}?\bset\s+not\s+null\b/ig },
];

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

function loadMigrationFiles() {
  if (!existsSync(migrationsDir)) fail("db/migrations is missing.");
  return readdirSync(migrationsDir)
    .filter((file) => /^\d+_[a-z0-9_]+\.sql$/i.test(file))
    .sort();
}

function analyzeMigrations(files) {
  return files.map((file) => {
    const fullPath = join(migrationsDir, file);
    const sql = readFileSync(fullPath, "utf8").replace(/^\uFEFF/, "");
    const destructiveTokens = [];
    for (const check of destructiveChecks) {
      if (check.regex.test(sql)) destructiveTokens.push(check.label);
      check.regex.lastIndex = 0;
    }
    return {
      file,
      version: basename(file, ".sql"),
      destructiveTokens,
      requiresManualAuthorization: destructiveTokens.length > 0,
    };
  });
}

function assertSafeRehearsalDatabase() {
  if (!rehearsalDatabaseUrl && !expectedDatabaseName) {
    return {
      mode: "static_only",
      database: "missing",
      temporaryDbWritten: false,
    };
  }
  if (!rehearsalDatabaseUrl || !expectedDatabaseName) {
    fail("Stage 9D rehearsal requires both STAGE9D_REHEARSAL_DATABASE_URL and STAGE9D_REHEARSAL_EXPECTED_NAME.");
  }
  if (!/^postgres(?:ql)?:\/\//i.test(rehearsalDatabaseUrl)) {
    fail("STAGE9D_REHEARSAL_DATABASE_URL must be a PostgreSQL connection string.");
  }
  const actualName = parseDatabaseName(rehearsalDatabaseUrl);
  if (!actualName || actualName !== expectedDatabaseName) {
    fail("Stage 9D rehearsal database name does not match the explicit expected name.");
  }
  if (!/(test|tmp|temp|stage9d|ci|rollback_drill|rehearsal|drill)/i.test(expectedDatabaseName)) {
    fail("Stage 9D rehearsal refuses to run unless the expected database name is clearly test-only.");
  }
  if (/(prod|production|staging|3106|3107|newapi)/i.test(expectedDatabaseName)) {
    fail("Stage 9D rehearsal refuses production, staging, service-port, or NewAPI database names.");
  }
  return {
    mode: "temporary_test_database",
    database: "configured/masked",
    temporaryDbWritten: true,
  };
}

function runNode(args, env = process.env) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env,
    encoding: "utf8",
    shell: false,
  });
  if (result.error) fail(result.error.message);
  if (result.status !== 0) {
    fail((result.stderr || result.stdout || `node ${args.join(" ")} failed`).trim());
  }
  return (result.stdout || "").trim();
}

const files = loadMigrationFiles();
const analysis = analyzeMigrations(files);
const latestVersion = analysis.at(-1)?.version || "";
const safety = assertSafeRehearsalDatabase();

let repeatabilityCheck = "not_run";
if (safety.mode === "temporary_test_database") {
  const env = {
    ...process.env,
    APP_DATABASE_URL: rehearsalDatabaseUrl,
    APP_DATABASE_EXPECTED_NAME: expectedDatabaseName,
    APP_DATABASE_MIGRATION_TARGET: latestVersion,
  };
  runNode(["scripts/database/migrate.mjs", "up"], env);
  runNode(["scripts/database/migrate.mjs", "status"], env);
  runNode(["scripts/database/migrate.mjs", "up"], env);
  repeatabilityCheck = "passed";
}

const destructiveFiles = analysis.filter((item) => item.destructiveTokens.length > 0);

console.log(JSON.stringify({
  ok: true,
  stage: "Stage 9D",
  mode: safety.mode,
  database: safety.database,
  migrationFiles: analysis.length,
  migrationOrder: analysis.map((item) => item.file),
  destructiveMigrationDetected: destructiveFiles.length > 0,
  destructiveFiles: destructiveFiles.map((item) => ({
    file: item.file,
    destructiveTokens: item.destructiveTokens,
  })),
  manualAuthorizationRequired: true,
  stagingExecutionRequiresSeparateAuthorization: true,
  productionExecutionForbidden: true,
  repeatabilityCheck,
  realDatabaseConnected: false,
  productionMigration: false,
  stagingMigration: false,
  productionDbWritten: false,
  stagingDbWritten: false,
  temporaryDbWritten: safety.temporaryDbWritten,
  newApiCalled: false,
  generationEndpointsCalled: false,
  realProviderCalled: false,
  costIncurred: false,
  secrets: "masked",
}, null, 2));
