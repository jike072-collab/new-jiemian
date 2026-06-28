#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupRestoredDirectories, createServiceBackup, restoreDataAndUploads, verifyBackupManifest } from "./ops/backup-utils.mjs";
import { createDatabaseRestoreAuthorization, prepareDatabaseRestore, restoreDatabaseBackup } from "./ops/database-restore.mjs";
import { getServiceConfig } from "./ops/service-config.mjs";

const root = await mkdtemp(join(tmpdir(), "aohuang-full-rollback-drill-"));
const realDatabaseUrl = process.env.ROLLBACK_DRILL_DATABASE_URL || "";
const expectedDatabaseName = process.env.ROLLBACK_DRILL_EXPECTED_DATABASE_NAME || "";
const markerTable = "aohuang_rollback_drill_marker";

function buildFakePostgresUrl() {
  return [
    "postgres",
    "ql://",
    "drill_user",
    ":",
    "drill_password",
    "@127.0.0.1:5432/drill_db",
  ].join("");
}

function parseDatabaseName(value) {
  try {
    const url = new URL(value);
    return decodeURIComponent(url.pathname.replace(/^\//, ""));
  } catch {
    return "";
  }
}

function assertSafeRollbackDrillDatabase() {
  if (!realDatabaseUrl) return;
  if (!expectedDatabaseName) {
    throw new Error("ROLLBACK_DRILL_EXPECTED_DATABASE_NAME is required when ROLLBACK_DRILL_DATABASE_URL is set.");
  }
  const actualName = parseDatabaseName(realDatabaseUrl);
  if (!actualName || actualName !== expectedDatabaseName) {
    throw new Error("Rollback drill database name does not match the explicit expected name.");
  }
  if (!/(test|tmp|temp|rollback|drill|stage9|ci)/i.test(expectedDatabaseName)) {
    throw new Error("Rollback drill refuses to run unless the expected database name is clearly test-only.");
  }
  if (/(prod|production|staging|3106|3107|newapi)/i.test(expectedDatabaseName)) {
    throw new Error("Rollback drill refuses production, staging, service-port, or NewAPI database names.");
  }
}

try {
  assertSafeRollbackDrillDatabase();
  mkdirSync(join(root, "data"), { recursive: true });
  mkdirSync(join(root, "uploads"), { recursive: true });
  mkdirSync(join(root, ".runtime"), { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ private: true }, null, 2));
  await writeFile(join(root, "data", "library.json"), JSON.stringify([{ id: "before" }]));
  await writeFile(join(root, "uploads", "asset.txt"), "upload-before");

  const fakeDump = join(root, "fake-pg-dump.mjs");
  const fakeRestore = join(root, "fake-pg-restore.mjs");
  const restoreLog = join(root, "pg-restore-log.json");
  if (realDatabaseUrl) {
    await writePostgresWrapper(fakeDump, "pg_dump", restoreLog);
    await writePostgresWrapper(fakeRestore, "pg_restore", restoreLog);
  } else {
    await writeFile(fakeDump, [
      "import { writeFileSync } from 'node:fs';",
      "if (process.argv.includes('--version')) { console.log('pg_dump (PostgreSQL) 16.14'); process.exit(0); }",
      "const index = process.argv.indexOf('--file');",
      "writeFileSync(process.argv[index + 1], 'fake custom dump');",
      "",
    ].join("\n"));
    await writeFile(fakeRestore, [
      "import { writeFileSync } from 'node:fs';",
      `const restoreLog = ${JSON.stringify(restoreLog)};`,
      "if (process.argv.includes('--version')) { console.log('pg_restore (PostgreSQL) 16.14'); process.exit(0); }",
      "if (process.argv.includes('--list')) { console.log('fake dump list'); process.exit(0); }",
      "writeFileSync(restoreLog, JSON.stringify({ mode: 'fake', args: process.argv.slice(2), hasPassword: Boolean(process.env.PGPASSWORD) }, null, 2));",
      "",
    ].join("\n"));
  }

  const config = getServiceConfig("production", { root });
  const env = {
    APP_DATABASE_URL: realDatabaseUrl || buildFakePostgresUrl(),
  };
  if (realDatabaseUrl) {
    runPsql(realDatabaseUrl, [
      `drop table if exists ${markerTable};`,
      `create table ${markerTable} (id integer primary key, label text not null);`,
      `insert into ${markerTable}(id, label) values (1, 'original-a'), (2, 'original-b');`,
    ]);
    assert.equal(queryPsql(realDatabaseUrl, `select string_agg(id || ':' || label, ',' order by id) from ${markerTable};`), "1:original-a,2:original-b");
  }
  const backup = createServiceBackup(config, {
    note: "isolated full rollback drill",
    env,
    deploymentId: "isolated-drill",
    databaseOptions: {
      pgDumpCommand: [process.execPath, fakeDump],
      pgRestoreCommand: [process.execPath, fakeRestore],
    },
  });
  const manifest = verifyBackupManifest(config, backup.backupDir);
  const authorization = createDatabaseRestoreAuthorization(config, manifest, env, {
    backupDir: backup.backupDir,
    sourceCommit: manifest.sourceCommit,
    targetCommit: "drill-target",
    deploymentId: "isolated-drill",
  });

  await writeFile(join(root, "data", "library.json"), JSON.stringify([{ id: "after" }]));
  await writeFile(join(root, "uploads", "asset.txt"), "upload-after");
  await writeFile(join(root, "data", "new.json"), "should disappear");
  if (realDatabaseUrl) {
    runPsql(realDatabaseUrl, [
      `update ${markerTable} set label = 'mutated' where id = 1;`,
      `delete from ${markerTable} where id = 2;`,
      `insert into ${markerTable}(id, label) values (3, 'new-row');`,
    ]);
    assert.equal(queryPsql(realDatabaseUrl, `select string_agg(id || ':' || label, ',' order by id) from ${markerTable};`), "1:mutated,3:new-row");
  }

  prepareDatabaseRestore(config, manifest, env, {
    pgRestoreCommand: [process.execPath, fakeRestore],
    rollbackAuthorization: authorization,
    expectedTargetCommit: "drill-target",
    deploymentId: "isolated-drill",
  });
  const restored = restoreDataAndUploads(config, backup.backupDir, { deferCleanup: true });
  await restoreDatabaseBackup(config, manifest, env, {
    pgRestoreCommand: [process.execPath, fakeRestore],
    rollbackAuthorization: authorization,
    expectedTargetCommit: "drill-target",
    deploymentId: "isolated-drill",
  });
  cleanupRestoredDirectories(restored);

  assert.equal(readFileSync(join(root, "data", "library.json"), "utf8"), JSON.stringify([{ id: "before" }]));
  assert.equal(readFileSync(join(root, "uploads", "asset.txt"), "utf8"), "upload-before");
  if (realDatabaseUrl) {
    assert.equal(queryPsql(realDatabaseUrl, `select string_agg(id || ':' || label, ',' order by id) from ${markerTable};`), "1:original-a,2:original-b");
  }
  assert.equal(authorization.used, true);
  const restoreReport = JSON.parse(readFileSync(restoreLog, "utf8"));
  assert(restoreReport.args.includes("--single-transaction"));
  assert(restoreReport.args.includes("--clean"));
  assert.equal(restoreReport.hasPassword, true);
  if (!realDatabaseUrl) assert(!JSON.stringify(manifest).includes("drill_password"));
  if (!realDatabaseUrl) assert(!JSON.stringify(authorization).includes("drill_password"));
  assert(!JSON.stringify(authorization).includes("postgresql://"));
  assert.throws(() => prepareDatabaseRestore(config, manifest, env, {
    pgRestoreCommand: [process.execPath, fakeRestore],
    rollbackAuthorization: authorization,
    expectedTargetCommit: "drill-target",
    deploymentId: "isolated-drill",
  }), /already been used/);

  console.log(JSON.stringify({
    ok: true,
    drill: "isolated-full-rollback",
    dataRestored: true,
    uploadsRestored: true,
    postgresRestorePrepared: true,
    postgresRestoreExecuted: true,
    postgresMode: realDatabaseUrl ? "real" : "fake",
    authorizationConsumed: true,
    secrets: "masked",
  }, null, 2));
} finally {
  if (realDatabaseUrl) {
    try {
      runPsql(realDatabaseUrl, [`drop table if exists ${markerTable};`]);
    } catch {
      // Cleanup should not hide the drill result.
    }
  }
  await rm(root, { recursive: true, force: true });
}

function runPsql(databaseUrl, statements) {
  const url = new URL(databaseUrl);
  const result = spawnSync("psql", [
    "--host", url.hostname,
    "--port", url.port || "5432",
    "--username", decodeURIComponent(url.username),
    "--dbname", decodeURIComponent(url.pathname.replace(/^\//, "")),
    "--set", "ON_ERROR_STOP=1",
    "--quiet",
    "--command", statements.join("\n"),
  ], {
    env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password || "") },
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `psql failed with status ${result.status}`);
  }
  return result.stdout.trim();
}

function queryPsql(databaseUrl, statement) {
  const url = new URL(databaseUrl);
  const result = spawnSync("psql", [
    "--host", url.hostname,
    "--port", url.port || "5432",
    "--username", decodeURIComponent(url.username),
    "--dbname", decodeURIComponent(url.pathname.replace(/^\//, "")),
    "--set", "ON_ERROR_STOP=1",
    "--tuples-only",
    "--no-align",
    "--quiet",
    "--command", statement,
  ], {
    env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password || "") },
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `psql query failed with status ${result.status}`);
  }
  return result.stdout.trim();
}

async function writePostgresWrapper(file, command, restoreLog) {
  await writeFile(file, [
    "import { spawnSync } from 'node:child_process';",
    "import { writeFileSync } from 'node:fs';",
    `const command = ${JSON.stringify(command)};`,
    `const restoreLog = ${JSON.stringify(restoreLog)};`,
    "const args = process.argv.slice(2);",
    "if (command === 'pg_restore' && !args.includes('--list')) {",
    "  writeFileSync(restoreLog, JSON.stringify({ mode: 'real', args, hasPassword: Boolean(process.env.PGPASSWORD) }, null, 2));",
    "}",
    "const result = spawnSync(command, args, { env: process.env, encoding: 'utf8', shell: false });",
    "if (result.stdout) process.stdout.write(result.stdout);",
    "if (result.stderr) process.stderr.write(result.stderr);",
    "process.exit(result.status ?? 1);",
    "",
  ].join("\n"));
}
