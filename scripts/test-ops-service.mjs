#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import net from "node:net";
import { buildRuntimeEnv, formatRuntimeEnvSummary } from "./ops/load-runtime-env.mjs";
import { getKnownServiceRoot, getServiceConfig } from "./ops/service-config.mjs";
import { getServiceStatus } from "./ops/service-status.mjs";
import { createServiceBackup, restoreDataAndUploads, rollbackRestoredDirectories, snapshotDirectory, verifyBackupManifest, writeRollbackScript } from "./ops/backup-utils.mjs";
import { createDatabaseBackup, createDatabaseFingerprint } from "./ops/database-backup.mjs";
import { createDatabaseRestoreAuthorization, prepareDatabaseRestore, restoreDatabaseBackup } from "./ops/database-restore.mjs";
import { classifyServiceProcess, createCommandFingerprint } from "./ops/process-identity.mjs";
import { stopService } from "./ops/stop-service.mjs";
import { runWatchdog } from "./ops/watchdog-service.mjs";
import {
  activatePreparedArtifacts,
  assertReleaseArtifactClean,
  buildReleaseCandidateVerificationEnv,
  createReleaseCandidateRoot,
  createReleaseValidationWorktreeRoot,
  sameVolume,
  shouldExcludeFromReleaseArtifact,
  waitForStoppedServiceArtifacts,
} from "./ops/deploy-service.mjs";
import { cleanupStaleServiceOperationLock, classifyOperationLock } from "./ops/operation-lock.mjs";

const tests = [];
let passed = 0;
let failed = 0;

const secret = "ops-test-secret-value-12345";

function test(name, fn) {
  tests.push({ name, fn });
}

async function withTempProject(fn) {
  const root = await mkdtemp(join(tmpdir(), "aohuang ops 中文 path "));
  try {
    mkdirSync(join(root, "data"), { recursive: true });
    mkdirSync(join(root, "uploads"), { recursive: true });
    mkdirSync(join(root, "data-staging"), { recursive: true });
    mkdirSync(join(root, "uploads-staging"), { recursive: true });
    mkdirSync(join(root, ".runtime"), { recursive: true });
    await writeFile(join(root, "package.json"), "{}");
    await writeFile(join(root, ".env.local"), [
      `AUTH_SESSION_SECRET=${secret}`,
      "APP_DATABASE_URL=postgresql://prod_user:prod_pass@127.0.0.1:5432/prod_db",
      "APP_DATABASE_EXPECTED_NAME=prod_db",
      "APP_AUTH_PERSISTENCE_MODE=postgres",
      "APP_BILLING_PERSISTENCE_MODE=postgres",
      "APP_TASK_BILLING_PERSISTENCE_MODE=postgres",
      "NEW_API_ENABLED=true",
      "NEW_API_BASE_URL=https://prod.example.test",
      "NEW_API_ENVIRONMENT=production",
      "NEW_API_ADMIN_USER_ID=1",
      "NEW_API_ADMIN_ACCESS_TOKEN=prod-token-secret",
      "",
    ].join("\n"));
    await writeFile(join(root, ".runtime", "staging.env"), [
      "AUTH_SESSION_SECRET=staging-secret-value-12345",
      "APP_DATABASE_URL=postgresql://staging_user:staging_pass@127.0.0.1:5432/staging_db",
      "APP_DATABASE_EXPECTED_NAME=staging_db",
      "APP_AUTH_PERSISTENCE_MODE=postgres",
      "APP_BILLING_PERSISTENCE_MODE=postgres",
      "APP_TASK_BILLING_PERSISTENCE_MODE=postgres",
      "NEW_API_ENABLED=true",
      "NEW_API_BASE_URL=https://staging.example.test",
      "NEW_API_ENVIRONMENT=production",
      "NEW_API_ADMIN_USER_ID=1",
      "NEW_API_ADMIN_ACCESS_TOKEN=staging-token-secret",
      "",
    ].join("\n"));
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function withProcessEnv(patch, fn) {
  const previous = {};
  for (const key of Object.keys(patch)) {
    previous[key] = process.env[key];
    if (patch[key] === undefined) delete process.env[key];
    else process.env[key] = patch[key];
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("production and staging environment files stay isolated", async () => {
  await withTempProject(async (root) => {
    const production = buildRuntimeEnv("production", { root });
    const staging = buildRuntimeEnv("staging", { root });
    assert.equal(production.env.PORT, "3106");
    assert.equal(staging.env.PORT, "3107");
    assert.equal(production.env.APP_DATABASE_EXPECTED_NAME, "prod_db");
    assert.equal(staging.env.APP_DATABASE_EXPECTED_NAME, "staging_db");
    assert.equal(production.env.DATA_DIR, join(root, "data"));
    assert.equal(staging.env.DATA_DIR, join(root, "data-staging"));
  });
});

test("environment values are masked in summaries", async () => {
  await withTempProject(async (root) => {
    const report = buildRuntimeEnv("production", { root });
    const summary = formatRuntimeEnvSummary(report.summary);
    assert(!summary.includes(secret));
    assert.match(summary, /adminAuthConfigured=true/);
    assert(!summary.includes("AUTH_SESSION_SECRET"));
  });
});

test("process.env overrides env files but service invariants still win", async () => {
  await withTempProject(async (root) => {
    const report = withProcessEnv({
      APP_DATABASE_EXPECTED_NAME: "process_db",
      DATA_DIR: join(root, "wrong-data"),
      UPLOADS_DIR: join(root, "wrong-uploads"),
    }, () => buildRuntimeEnv("staging", { root }));
    assert.equal(report.env.APP_DATABASE_EXPECTED_NAME, "process_db");
    assert.equal(report.sources.APP_DATABASE_EXPECTED_NAME, "process");
    assert.equal(report.env.DATA_DIR, join(root, "data-staging"));
    assert.equal(report.env.UPLOADS_DIR, join(root, "uploads-staging"));
    assert.equal(report.sources.DATA_DIR, "service-invariant");
  });
});

test("missing required environment fails before process stop", async () => {
  await withTempProject(async (root) => {
    await writeFile(join(root, ".env.local"), "AUTH_SESSION_SECRET=only-secret\n");
    const result = spawnSync(process.execPath, ["scripts/ops/start-service.mjs", "production", "--root", root, "--preflight-only"], {
      cwd: process.cwd(),
      encoding: "utf8",
      shell: false,
    });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /Missing required runtime configuration before stopping any process/);
    assert.match(`${result.stdout}\n${result.stderr}`, /database/);
    assert(!`${result.stdout}\n${result.stderr}`.includes("APP_DATABASE_URL"));
  });
});

test("occupied port is rejected before duplicate start", async () => {
  await withTempProject(async (root) => {
    const port = await findAvailablePort();
    const server = net.createServer();
    await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
    try {
      const result = spawnSync(process.execPath, ["scripts/ops/start-service.mjs", "staging", "--root", root], {
        cwd: process.cwd(),
        encoding: "utf8",
        shell: false,
        env: {
          ...process.env,
          STAGING_PORT: String(port),
        },
      });
      assert.notEqual(result.status, 0);
      assert.match(`${result.stdout}\n${result.stderr}`, /already in use/);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

test("health check failure returns non-zero from CLI", () => {
  const result = spawnSync(process.execPath, ["scripts/ops/health-check.mjs", "staging", "--repeat", "1"], {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: false,
    env: {
      ...process.env,
      AOHUANG_STAGING_ROOT: process.cwd(),
      STAGING_PORT: "49999",
    },
  });
  assert.notEqual(result.status, 0);
});

test("status command identifies invalid pid as not listening", async () => {
  await withTempProject(async (root) => {
    const status = await withProcessEnv({ STAGING_PORT: "49999" }, () => getServiceStatus("staging", { root }));
    assert.equal(status.listening, false);
    assert.equal(status.pid, null);
  });
});

test("stale state is detected without killing a reused pid", async () => {
  await withTempProject(async (root) => {
    const config = getServiceConfig("staging", { root, port: "49999" });
    await writeFile(config.stateFile, JSON.stringify({
      serviceName: "staging",
      port: config.port,
      pid: 999999,
      workdir: config.root,
      dataDir: config.dataDir,
      uploadsDir: config.uploadsDir,
    }, null, 2));
    const identity = await classifyServiceProcess("staging", { root, port: config.port });
    assert.equal(identity.status, "stale");
  });
});

test("owned service state keeps watchdog from misclassifying a matching process", async () => {
  await withTempProject(async (root) => {
    const port = await findAvailablePort();
    const server = http.createServer((request, response) => {
      response.writeHead(200);
      response.end("ok");
    });
    await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
    try {
      const config = getServiceConfig("staging", { root, port: String(port) });
      await writeFile(config.stateFile, JSON.stringify({
        statusVersion: 2,
        serviceName: "staging",
        service: "staging",
        port: config.port,
        pid: process.pid,
        workdir: config.root,
        root: config.root,
        runtimeRoot: config.root,
        dataDir: config.dataDir,
        uploadsDir: config.uploadsDir,
        command: `node ${join(config.root, "node_modules", "next", "dist", "bin", "next")} start -H 127.0.0.1 -p ${config.port}`,
        processStartedAt: "2026-06-25T00:00:00.000Z",
      }, null, 2));
      const identity = await classifyServiceProcess("staging", {
        root,
        port: config.port,
        listeningPidProvider: () => process.pid,
        processInfoProvider: () => ({
          ProcessId: process.pid,
          ParentProcessId: process.ppid,
          CommandLine: `\"C:\\Program Files\\nodejs\\node.exe\" next start -H 127.0.0.1 -p ${config.port}`,
          CreationDate: "2026-06-25T00:00:00.000Z",
        }),
      });
      assert.equal(identity.status, "owned");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

test("foreign port occupant is not stopped", async () => {
  await withTempProject(async (root) => {
    const port = await findAvailablePort();
    const server = net.createServer((socket) => socket.end("foreign"));
    await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
    try {
      await assertRejectsAsync(() => stopService("staging", { root, port: String(port) }), /refused/);
      assert.equal(server.listening, true);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

test("windows process stop remains behind owned identity checks", () => {
  const stopSource = readFileSync(join(process.cwd(), "scripts", "ops", "stop-service.mjs"), "utf8");
  const processSource = readFileSync(join(process.cwd(), "scripts", "ops", "process-utils.mjs"), "utf8");
  assert.match(stopSource, /assertOwnedIdentity\(identity, "stop-service"\);\s+stopProcessTree\(identity\.pid\);/);
  assert(processSource.includes('"taskkill.exe", ["/PID", String(pid), "/T", "/F"]'));
});

test("status command reads commit from git metadata without git process access", async () => {
  await withTempProject(async (root) => {
    const commit = "04674d00060334ddfeb018b2724f6fa1c988f7a5";
    mkdirSync(join(root, ".git"), { recursive: true });
    await writeFile(join(root, ".git", "HEAD"), `${commit}\n`);
    const status = await getServiceStatus("staging", { root, port: "49999" });
    assert.equal(status.commit, commit);
  });
});

test("status command treats an occupied port as listening", async () => {
  await withTempProject(async (root) => {
    const port = await findAvailablePort();
    const server = http.createServer((request, response) => {
      response.writeHead(request.url === "/" ? 200 : 404);
      response.end("ops status test");
    });
    await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
    try {
      const status = await getServiceStatus("staging", { root, port: String(port), timeoutMs: 100 });
      assert.equal(status.listening, true);
      assert.equal(status.healthOk, false);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

test("backup and rollback script are generated without touching data", async () => {
  await withTempProject(async (root) => {
    await writeFile(join(root, "data", "library.json"), "[]");
    const config = getServiceConfig("production", { root });
    const before = snapshotDirectory(config.dataDir);
    const backup = createServiceBackup(config, { note: "ops test" });
    const rollback = writeRollbackScript(config, backup, "abc123");
    assert.equal(existsSync(rollback), true);
    assert.equal(readFileSync(rollback, "utf8").includes("abc123"), true);
    const after = snapshotDirectory(config.dataDir);
    assert.deepEqual(after, before);
  });
});

test("legacy owned service fingerprint remains stoppable after runtime-root upgrade", async () => {
  await withTempProject(async (root) => {
    const port = await findAvailablePort();
    const server = http.createServer((request, response) => {
      response.writeHead(200);
      response.end("ok");
    });
    await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
    try {
      const config = getServiceConfig("staging", { root, port: String(port) });
      await writeFile(config.stateFile, JSON.stringify({
        statusVersion: 2,
        serviceName: "staging",
        service: "staging",
        port: config.port,
        pid: process.pid,
        workdir: config.root,
        root: config.root,
        dataDir: config.dataDir,
        uploadsDir: config.uploadsDir,
        commandFingerprint: createHash("sha256").update([
          config.service,
          config.root.toLowerCase(),
          String(config.port),
          join(config.root, "node_modules", "next", "dist", "bin", "next").toLowerCase(),
          "next start -H 127.0.0.1",
        ].join("|")).digest("hex"),
        command: `node ${join(config.root, "node_modules", "next", "dist", "bin", "next")} start -H 127.0.0.1`,
        processStartedAt: "2026-06-25T00:00:00.000Z",
      }, null, 2));
      const identity = await classifyServiceProcess("staging", {
        root,
        port: config.port,
        listeningPidProvider: () => process.pid,
        processInfoProvider: () => ({
          ProcessId: process.pid,
          ParentProcessId: process.ppid,
          CommandLine: `\"C:\\Program Files\\nodejs\\node.exe\" ${join(config.root, "node_modules", "next", "dist", "bin", "next")} start -H 127.0.0.1 -p ${config.port}`,
          CreationDate: "2026-06-25T00:00:00.000Z",
        }),
      });
      assert.equal(identity.status, "owned");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

test("service backup ignores release candidates and build artifacts", async () => {
  await withTempProject(async (root) => {
    const config = getServiceConfig("staging", { root });
    mkdirSync(join(root, "database"), { recursive: true });
    mkdirSync(join(root, ".runtime", "releases", "candidate"), { recursive: true });
    mkdirSync(join(root, ".next", "cache"), { recursive: true });
    mkdirSync(join(root, "node_modules"), { recursive: true });
    await writeFile(join(root, "database", "app.sqlite"), "real-db");
    await writeFile(join(root, ".runtime", "releases", "candidate", "nested.sqlite"), "release-db");
    await writeFile(join(root, ".next", "cache", "ignored.sqlite"), "build-db");
    await writeFile(join(root, "node_modules", "ignored.sqlite"), "module-db");
    const backup = createServiceBackup(config, { note: "ignore release artifacts" });
    const dbFiles = JSON.parse(readFileSync(join(backup.backupDir, "checksums.json"), "utf8"))
      .map((entry) => entry.path)
      .filter((path) => path.startsWith("db-files/"));
    assert(dbFiles.some((path) => path.includes("database_app.sqlite")));
    assert(!dbFiles.some((path) => path.includes("nested.sqlite")));
    assert(!dbFiles.some((path) => path.includes("ignored.sqlite")));
  });
});

test("directory snapshots include content checksums", async () => {
  await withTempProject(async (root) => {
    const config = getServiceConfig("production", { root });
    await writeFile(join(root, "data", "library.json"), "before");
    const before = snapshotDirectory(config.dataDir);
    await writeFile(join(root, "data", "library.json"), "after");
    const after = snapshotDirectory(config.dataDir);
    assert.equal(before.count, after.count);
    assert.notEqual(before.sha256, after.sha256);
  });
});

test("windows PowerShell rollback script forwards one-time authorization arguments", async () => {
  if (process.platform !== "win32") return;
  await withTempProject(async (root) => {
    const config = getServiceConfig("production", { root });
    const backup = createServiceBackup(config, { note: "powershell rollback test", deploymentId: "deployment-powershell" });
    const authFile = join(backup.backupDir, "rollback-authorization.pending.json");
    await writeFile(authFile, "{}");
    const rollback = writeRollbackScript(config, backup, "abc123", {
      rollbackAuthorizationFile: authFile,
      deploymentId: "deployment-powershell",
    });
    const shimDir = join(root, "node-shim");
    mkdirSync(shimDir, { recursive: true });
    const capture = join(root, "powershell-rollback-args.txt");
    await writeFile(join(shimDir, "node.cmd"), [
      "@echo off",
      `echo %* > "${capture}"`,
      "exit /b 0",
      "",
    ].join("\r\n"));
    const result = spawnSync("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      rollback,
    ], {
      cwd: root,
      env: { ...process.env, PATH: `${shimDir};${process.env.PATH || ""}` },
      encoding: "utf8",
      shell: false,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const args = readFileSync(capture, "utf8");
    assert(args.includes("scripts/ops/rollback-service.mjs production"));
    assert(args.includes("--rollback-authorization-file"));
    assert(args.includes(authFile));
    assert(args.includes("--deployment-id deployment-powershell"));
  });
});

test("full rollback restores data and uploads from verified backup", async () => {
  await withTempProject(async (root) => {
    await writeFile(join(root, "data", "library.json"), "before");
    await writeFile(join(root, "uploads", "asset.txt"), "upload-before");
    const config = getServiceConfig("production", { root });
    const backup = createServiceBackup(config, { note: "rollback test" });
    await writeFile(join(root, "data", "library.json"), "after");
    await writeFile(join(root, "data", "new.json"), "new");
    await writeFile(join(root, "uploads", "asset.txt"), "upload-after");
    restoreDataAndUploads(config, backup.backupDir);
    assert.equal(readFileSync(join(root, "data", "library.json"), "utf8"), "before");
    assert.equal(existsSync(join(root, "data", "new.json")), false);
    assert.equal(readFileSync(join(root, "uploads", "asset.txt"), "utf8"), "upload-before");
  });
});

test("rollback restore leaves official directories unchanged when data prepare fails", async () => {
  await assertRestoreFailurePreservesRuntime("data prepare failed", async ({ config, backup }) => {
    await writeFile(join(backup.backupDir, "data", "library.json"), "corrupt");
    assert.throws(() => restoreDataAndUploads(config, backup.backupDir), /checksum mismatch/);
  });
});

test("rollback restore leaves official directories unchanged when uploads prepare fails", async () => {
  await assertRestoreFailurePreservesRuntime("uploads prepare failed", async ({ config, backup }) => {
    await writeFile(join(backup.backupDir, "uploads", "asset.txt"), "corrupt");
    assert.throws(() => restoreDataAndUploads(config, backup.backupDir), /checksum mismatch/);
  });
});

test("rollback restore leaves official directories unchanged when data staged and uploads prepare fails", async () => {
  await assertRestoreFailurePreservesRuntime("data staged uploads prepare failed", async ({ config, backup }) => {
    assert.throws(() => restoreDataAndUploads(config, backup.backupDir, {
      beforePrepare: (name) => {
        if (name === "uploads") throw new Error("simulated uploads prepare failure");
      },
    }), /uploads prepare failure/);
  });
});

test("rollback restore restores data when data commit succeeds and uploads commit fails", async () => {
  await assertRestoreFailurePreservesRuntime("data commit succeeded uploads commit failed", async ({ config, backup }) => {
    const rename = (source, target) => {
      if (source.includes("uploads.restore-")) throw new Error("simulated uploads commit failure");
      return renameSync(source, target);
    };
    assert.throws(() => restoreDataAndUploads(config, backup.backupDir, { rename }), /uploads commit failure/);
  });
});

test("rollback restore can roll back both committed directories after database restore failure", async () => {
  await assertRestoreFailurePreservesRuntime("database restore failed after both commits", async ({ config, backup }) => {
    const restoreState = restoreDataAndUploads(config, backup.backupDir, { deferCleanup: true });
    assert.throws(() => {
      throw new Error("simulated database restore failure");
    }, /database restore failure/);
    rollbackRestoredDirectories(restoreState);
  });
});

test("corrupt rollback backup fails before restore", async () => {
  await withTempProject(async (root) => {
    await writeFile(join(root, "data", "library.json"), "before");
    const config = getServiceConfig("production", { root });
    const backup = createServiceBackup(config, { note: "corrupt rollback test" });
    await writeFile(join(backup.backupDir, "data", "library.json"), "corrupt");
    assert.throws(() => verifyBackupManifest(config, backup.backupDir), /checksum mismatch/);
  });
});

test("postgres backup uses pg_dump and pg_restore without logging the connection string", async () => {
  await withTempProject(async (root) => {
    const bin = join(root, "fake-bin");
    mkdirSync(bin, { recursive: true });
    const fakeDump = join(bin, "pg-dump.mjs");
    const fakeRestore = join(bin, "pg-restore.mjs");
    await writeFile(fakeDump, [
      "import { writeFileSync } from 'node:fs';",
      "if (process.argv.includes('--version')) { console.log('pg_dump (PostgreSQL) 16.0'); process.exit(0); }",
      "const index = process.argv.indexOf('--file');",
      "writeFileSync(process.argv[index + 1], 'fake dump');",
      "",
    ].join("\n"));
    await writeFile(fakeRestore, [
      "if (process.argv.includes('--version')) { console.log('pg_restore (PostgreSQL) 16.0'); process.exit(0); }",
      "if (process.argv.includes('--list')) { console.log('fake list'); process.exit(0); }",
      "",
    ].join("\n"));
    const config = getServiceConfig("production", { root });
    const result = withProcessEnv({
      APP_DATABASE_URL: "postgresql://example_user:example_password@127.0.0.1:5432/app_db",
    }, () => createDatabaseBackup(config, {
      backupDir: join(root, "backup"),
      pgDumpCommand: [process.execPath, fakeDump],
      pgRestoreCommand: [process.execPath, fakeRestore],
    }));
    assert.equal(result.type, "postgres");
    assert.equal(existsSync(result.files[0]), true);
    assert(!JSON.stringify(result).includes("example_password"));
    assert(!JSON.stringify(result).includes("postgresql://"));
  });
});

test("staging postgres backup fails closed without leaking the connection string", async () => {
  await withTempProject(async (root) => {
    const fakeDump = join(root, "pg-dump-fail.mjs");
    const fakeRestore = join(root, "pg-restore.mjs");
    await writeFile(fakeDump, [
      "if (process.argv.includes('--version')) { console.log('pg_dump (PostgreSQL) 16.0'); process.exit(0); }",
      "console.error('backup unavailable');",
      "process.exit(1);",
      "",
    ].join("\n"));
    await writeFile(fakeRestore, [
      "if (process.argv.includes('--version')) { console.log('pg_restore (PostgreSQL) 16.0'); process.exit(0); }",
      "",
    ].join("\n"));
    const config = getServiceConfig("staging", { root });
    assert.throws(() => createDatabaseBackup(config, {
      backupDir: join(root, "backup"),
      env: {
        APP_DATABASE_URL: "postgresql://example_user:example_password@127.0.0.1:5432/app_db",
      },
      pgDumpCommand: [process.execPath, fakeDump],
      pgRestoreCommand: [process.execPath, fakeRestore],
    }), /backup unavailable/);
  });
});

test("production postgres backup still fails closed when unavailable", async () => {
  await withTempProject(async (root) => {
    const fakeDump = join(root, "pg-dump-fail.mjs");
    const fakeRestore = join(root, "pg-restore.mjs");
    await writeFile(fakeDump, [
      "if (process.argv.includes('--version')) { console.log('pg_dump (PostgreSQL) 16.0'); process.exit(0); }",
      "console.error('backup unavailable');",
      "process.exit(1);",
      "",
    ].join("\n"));
    await writeFile(fakeRestore, [
      "if (process.argv.includes('--version')) { console.log('pg_restore (PostgreSQL) 16.0'); process.exit(0); }",
      "",
    ].join("\n"));
    const config = getServiceConfig("production", { root });
    assert.throws(() => createDatabaseBackup(config, {
      backupDir: join(root, "backup"),
      env: {
        APP_DATABASE_URL: "postgresql://example_user:example_password@127.0.0.1:5432/app_db",
      },
      pgDumpCommand: [process.execPath, fakeDump],
      pgRestoreCommand: [process.execPath, fakeRestore],
    }), /backup unavailable/);
  });
});

test("postgres restore refuses destructive restore without deployment authorization", async () => {
  await withTempProject(async (root) => {
    const config = getServiceConfig("production", { root });
    const dump = join(root, "backup", "database", "production-postgres.dump");
    mkdirSync(join(root, "backup", "database"), { recursive: true });
    await writeFile(dump, "fake dump");
    const fakeRestore = join(root, "pg-restore.mjs");
    await writeFile(fakeRestore, [
      "if (process.argv.includes('--version')) { console.log('pg_restore (PostgreSQL) 16.0'); process.exit(0); }",
      "if (process.argv.includes('--list')) { console.log('fake list'); process.exit(0); }",
      "",
    ].join("\n"));
    const manifest = {
      serviceName: "production",
      backupDir: join(root, "backup"),
      databaseBackup: {
        type: "postgres",
        files: [dump],
        databaseName: "app_db",
        fingerprint: createDatabaseFingerprint(config, {
          APP_DATABASE_URL: "postgresql://example_user:example_password@127.0.0.1:5432/app_db",
        }),
      },
    };
    await writeFile(join(root, "backup", "backup-manifest.json"), JSON.stringify(manifest, null, 2));
    assert.throws(() => prepareDatabaseRestore(config, manifest, {
      APP_DATABASE_URL: "postgresql://example_user:example_password@127.0.0.1:5432/app_db",
    }, { pgRestoreCommand: [process.execPath, fakeRestore] }), /requires deployment-scoped rollback authorization/);
  });
});

test("postgres restore authorization is fingerprint-bound and one-time", async () => {
  await withTempProject(async (root) => {
    const config = getServiceConfig("production", { root });
    const backupDir = join(root, "backup");
    const dump = join(backupDir, "database", "production-postgres.dump");
    mkdirSync(join(backupDir, "database"), { recursive: true });
    await writeFile(dump, "fake dump");
    const fakeRestore = join(root, "pg-restore.mjs");
    await writeFile(fakeRestore, [
      "if (process.argv.includes('--version')) { console.log('pg_restore (PostgreSQL) 16.0'); process.exit(0); }",
      "if (process.argv.includes('--list')) { console.log('fake list'); process.exit(0); }",
      "process.exit(0);",
      "",
    ].join("\n"));
    const env = {
      APP_DATABASE_URL: "postgresql://example_user:example_password@127.0.0.1:5432/app_db",
    };
    const manifest = {
      backupVersion: 2,
      deploymentId: "deployment-1",
      serviceName: "production",
      backupDir,
      sourceCommit: "source-commit",
      databaseBackup: {
        type: "postgres",
        files: [dump],
        databaseName: "app_db",
        fingerprint: createDatabaseFingerprint(config, env),
      },
    };
    await writeFile(join(backupDir, "backup-manifest.json"), JSON.stringify(manifest, null, 2));
    const authorization = createDatabaseRestoreAuthorization(config, manifest, env, {
      backupDir,
      sourceCommit: "source-commit",
      targetCommit: "target-commit",
      deploymentId: "deployment-1",
    });
    prepareDatabaseRestore(config, manifest, env, {
      pgRestoreCommand: [process.execPath, fakeRestore],
      rollbackAuthorization: authorization,
      expectedTargetCommit: "target-commit",
      deploymentId: "deployment-1",
    });
    assert.equal(authorization.used, false);
    await restoreDatabaseBackup(config, manifest, env, {
      pgRestoreCommand: [process.execPath, fakeRestore],
      rollbackAuthorization: authorization,
      expectedTargetCommit: "target-commit",
      deploymentId: "deployment-1",
    });
    assert.equal(authorization.used, true);
    assert.throws(() => prepareDatabaseRestore(config, manifest, env, {
      pgRestoreCommand: [process.execPath, fakeRestore],
      rollbackAuthorization: authorization,
      expectedTargetCommit: "target-commit",
      deploymentId: "deployment-1",
    }), /already been used/);
    assert(!JSON.stringify(authorization).includes("example_password"));
    assert(!JSON.stringify(authorization).includes("postgresql://"));
  });
});

test("postgres restore emits heartbeat progress during long restore", async () => {
  await withTempProject(async (root) => {
    const config = getServiceConfig("production", { root });
    const backupDir = join(root, "backup");
    const dump = join(backupDir, "database", "production-postgres.dump");
    mkdirSync(join(backupDir, "database"), { recursive: true });
    await writeFile(dump, "fake dump");
    const fakeRestore = join(root, "pg-restore-slow.mjs");
    await writeFile(fakeRestore, [
      "if (process.argv.includes('--list')) { console.log('fake list'); process.exit(0); }",
      "setTimeout(() => process.exit(0), 80);",
      "",
    ].join("\n"));
    const env = {
      APP_DATABASE_URL: "postgresql://example_user:example_password@127.0.0.1:5432/app_db",
    };
    const manifest = {
      backupVersion: 2,
      deploymentId: "deployment-heartbeat",
      serviceName: "production",
      backupDir,
      sourceCommit: "source-commit",
      databaseBackup: {
        type: "postgres",
        files: [dump],
        databaseName: "app_db",
        fingerprint: createDatabaseFingerprint(config, env),
      },
    };
    await writeFile(join(backupDir, "backup-manifest.json"), JSON.stringify(manifest, null, 2));
    const authorization = createDatabaseRestoreAuthorization(config, manifest, env, {
      backupDir,
      sourceCommit: "source-commit",
      targetCommit: "target-commit",
      deploymentId: "deployment-heartbeat",
    });
    const phases = [];
    await restoreDatabaseBackup(config, manifest, env, {
      pgRestoreCommand: [process.execPath, fakeRestore],
      rollbackAuthorization: authorization,
      expectedTargetCommit: "target-commit",
      deploymentId: "deployment-heartbeat",
      heartbeatMs: 10,
      onProgress: (event) => phases.push(event.phase),
    });
    assert(phases.includes("before-pg-restore"));
    assert(phases.includes("pg-restore-started"));
    assert(phases.includes("pg-restore-heartbeat"));
    assert(phases.includes("after-pg-restore"));
  });
});

test("postgres restore authorization refuses a different target database", async () => {
  await withTempProject(async (root) => {
    const config = getServiceConfig("production", { root });
    const backupDir = join(root, "backup");
    const dump = join(backupDir, "database", "production-postgres.dump");
    mkdirSync(join(backupDir, "database"), { recursive: true });
    await writeFile(dump, "fake dump");
    const fakeRestore = join(root, "pg-restore.mjs");
    await writeFile(fakeRestore, [
      "if (process.argv.includes('--list')) { console.log('fake list'); process.exit(0); }",
      "",
    ].join("\n"));
    const env = {
      APP_DATABASE_URL: "postgresql://example_user:example_password@127.0.0.1:5432/app_db",
    };
    const manifest = {
      backupVersion: 2,
      deploymentId: "deployment-1",
      serviceName: "production",
      backupDir,
      sourceCommit: "source-commit",
      databaseBackup: {
        type: "postgres",
        files: [dump],
        databaseName: "app_db",
        fingerprint: createDatabaseFingerprint(config, env),
      },
    };
    await writeFile(join(backupDir, "backup-manifest.json"), JSON.stringify(manifest, null, 2));
    const authorization = createDatabaseRestoreAuthorization(config, manifest, env, {
      backupDir,
      sourceCommit: "source-commit",
      targetCommit: "target-commit",
      deploymentId: "deployment-1",
    });
    assert.throws(() => prepareDatabaseRestore(config, manifest, {
      APP_DATABASE_URL: "postgresql://example_user:example_password@127.0.0.1:5432/other_db",
    }, {
      pgRestoreCommand: [process.execPath, fakeRestore],
      rollbackAuthorization: authorization,
      expectedTargetCommit: "target-commit",
      deploymentId: "deployment-1",
    }), /fingerprint/);
  });
});

test("watchdog leaves a healthy owned service alone when pid lookup is supported", async () => {
  await withTempProject(async (root) => {
    if (process.platform !== "win32") return;
    const port = await findAvailablePort();
    const config = getServiceConfig("staging", { root, port: String(port) });
    let requests = 0;
    const server = http.createServer((request, response) => {
      requests += 1;
      response.writeHead(request.url === "/admin/providers" ? 307 : 200);
      response.end("ok");
    });
    await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
    await writeFile(config.stateFile, JSON.stringify({
      statusVersion: 2,
      serviceName: "staging",
      service: "staging",
      port: config.port,
      pid: process.pid,
      workdir: config.root,
      root: config.root,
      dataDir: config.dataDir,
      uploadsDir: config.uploadsDir,
      runtimeCommit: "runtime",
      commandFingerprint: createCommandFingerprint(config),
    }, null, 2));
    try {
      const result = await runWatchdog("staging", {
        root,
        port: String(port),
        timeoutMs: 100,
        processInfoProvider: () => ({
          ProcessId: process.pid,
          ParentProcessId: process.ppid,
          CommandLine: `node ${join(root, "node_modules", "next", "dist", "bin", "next")} start -H 127.0.0.1 -p ${port}`,
        }),
      });
      assert.equal(result.ok, true);
      assert.equal(result.action, "none");
      assert(requests > 0);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

test("watchdog refuses a foreign port occupant", async () => {
  await withTempProject(async (root) => {
    const port = await findAvailablePort();
    const server = net.createServer((socket) => socket.end("foreign"));
    await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
    try {
      await assertRejectsAsync(() => runWatchdog("staging", { root, port: String(port), timeoutMs: 100 }), /refused/);
      assert.equal(server.listening, true);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

test("watchdog refuses ambiguous occupied ports when pid lookup is unavailable", async () => {
  if (process.platform === "win32") return;
  await withTempProject(async (root) => {
    const port = await findAvailablePort();
    const server = net.createServer((socket) => socket.end("occupied"));
    await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
    try {
      await assertRejectsAsync(() => runWatchdog("staging", { root, port: String(port), timeoutMs: 100 }), /ambiguous/);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

test("watchdog defers while rollback_failed lock is present", async () => {
  await withTempProject(async (root) => {
    const config = getServiceConfig("staging", { root });
    writeFileSync(join(config.runtimeDir, `operation-${config.service}.lock`), JSON.stringify({
      lockVersion: 1,
      serviceName: config.service,
      operation: "rollback_failed",
      createdAt: new Date().toISOString(),
    }, null, 2));
    const result = await runWatchdog("staging", { root, timeoutMs: 100 });
    assert.equal(result.ok, true);
    assert.equal(result.deferred, true);
    assert.equal(result.operation, "rollback_failed");
    assert.equal(result.lockStatus, "failed");
  });
});

test("operation lock remains active after 30 minutes when pid is alive", async () => {
  await withTempProject(async (root) => {
    const config = getServiceConfig("staging", { root });
    writeOperationLock(config, {
      operation: "deploy",
      pid: 12345,
      processStartedAt: "2026-06-25T00:00:00.000Z",
      updatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    const status = await classifyOperationLock(config, undefined, {
      processInfoProvider: () => ({ ProcessId: 12345, CreationDate: "2026-06-25T00:00:00.000Z" }),
    });
    assert.equal(status.status, "active");
    await assertRejectsAsync(() => cleanupStaleServiceOperationLock(config, {
      processInfoProvider: () => ({ ProcessId: 12345, CreationDate: "2026-06-25T00:00:00.000Z" }),
    }), /active/);
  });
});

test("operation lock rollback_failed is not automatically deleted", async () => {
  await withTempProject(async (root) => {
    const config = getServiceConfig("staging", { root });
    writeOperationLock(config, {
      operation: "rollback_failed",
      pid: 12345,
      updatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    const status = await classifyOperationLock(config, undefined, {
      processInfoProvider: () => null,
    });
    assert.equal(status.status, "failed");
    await assertRejectsAsync(() => cleanupStaleServiceOperationLock(config, {
      processInfoProvider: () => null,
    }), /failed/);
  });
});

test("operation lock with missing pid and inactive service becomes stale", async () => {
  await withTempProject(async (root) => {
    const config = getServiceConfig("staging", { root, port: "49999" });
    writeOperationLock(config, {
      operation: "deploy",
      pid: 12345,
      updatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    const status = await classifyOperationLock(config, undefined, {
      processInfoProvider: () => null,
    });
    assert.equal(status.status, "stale");
    await cleanupStaleServiceOperationLock(config, {
      processInfoProvider: () => null,
    });
    assert.equal(existsSync(join(config.runtimeDir, `operation-${config.service}.lock`)), false);
  });
});

test("operation lock stays active while database restore subprocess is running", async () => {
  await withTempProject(async (root) => {
    const config = getServiceConfig("staging", { root, port: "49999" });
    writeOperationLock(config, {
      operation: "rollback",
      pid: 12345,
      deploymentId: "deployment-db-child",
      updatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    const status = await classifyOperationLock(config, undefined, {
      processInfoProvider: () => null,
      databaseChildProcessProvider: (details) => details.deploymentId === "deployment-db-child",
    });
    assert.equal(status.status, "active");
    assert.equal(status.reason, "database-subprocess-active");
  });
});

test("operation lock with reused pid becomes stale", async () => {
  await withTempProject(async (root) => {
    const config = getServiceConfig("staging", { root });
    writeOperationLock(config, {
      operation: "rollback",
      pid: 12345,
      processStartedAt: "2026-06-25T00:00:00.000Z",
      updatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    const status = await classifyOperationLock(config, undefined, {
      processInfoProvider: () => ({ ProcessId: 12345, CreationDate: "2026-06-25T01:00:00.000Z" }),
    });
    assert.equal(status.status, "stale");
  });
});

test("operation lock with reused pid stays active when database child is still running", async () => {
  await withTempProject(async (root) => {
    const config = getServiceConfig("staging", { root });
    writeOperationLock(config, {
      operation: "rollback",
      pid: 12345,
      processStartedAt: "2026-06-25T00:00:00.000Z",
      deploymentId: "deployment-db-child",
      updatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    const status = await classifyOperationLock(config, undefined, {
      processInfoProvider: () => ({ ProcessId: 12345, CreationDate: "2026-06-25T01:00:00.000Z" }),
      databaseChildProcessProvider: (details) => details.deploymentId === "deployment-db-child",
    });
    assert.equal(status.status, "active");
    assert.equal(status.reason, "database-subprocess-active");
  });
});

test("corrupt operation lock is preserved and classified unknown", async () => {
  await withTempProject(async (root) => {
    const config = getServiceConfig("staging", { root });
    writeFileSync(join(config.runtimeDir, `operation-${config.service}.lock`), "{not-json");
    const status = await classifyOperationLock(config);
    assert.equal(status.status, "unknown");
    await assertRejectsAsync(() => cleanupStaleServiceOperationLock(config), /unknown/);
    assert.equal(existsSync(join(config.runtimeDir, `operation-${config.service}.lock`)), true);
  });
});

test("watchdog defers for active, failed, and unknown operation locks but ignores stale locks", async () => {
  await withTempProject(async (root) => {
    const config = getServiceConfig("staging", { root, port: "49999" });
    writeOperationLock(config, {
      operation: "deploy",
      pid: 12345,
      processStartedAt: "2026-06-25T00:00:00.000Z",
      updatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    const active = await runWatchdog("staging", {
      root,
      port: "49999",
      timeoutMs: 100,
      operationLockOptions: {
        processInfoProvider: () => ({ ProcessId: 12345, CreationDate: "2026-06-25T00:00:00.000Z" }),
      },
    });
    assert.equal(active.deferred, true);
    assert.equal(active.lockStatus, "active");

    writeOperationLock(config, {
      operation: "rollback_failed",
      pid: 12345,
      updatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    const failed = await runWatchdog("staging", {
      root,
      port: "49999",
      timeoutMs: 100,
      operationLockOptions: { processInfoProvider: () => null },
    });
    assert.equal(failed.deferred, true);
    assert.equal(failed.lockStatus, "failed");

    writeFileSync(join(config.runtimeDir, `operation-${config.service}.lock`), "{not-json");
    const unknown = await runWatchdog("staging", { root, port: "49999", timeoutMs: 100 });
    assert.equal(unknown.deferred, true);
    assert.equal(unknown.lockStatus, "unknown");

    writeOperationLock(config, {
      operation: "deploy",
      pid: 12345,
      updatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    await assertRejectsAsync(() => runWatchdog("staging", {
      root,
      port: "49999",
      timeoutMs: 100,
      operationLockOptions: { processInfoProvider: () => null },
    }), /already in use|Next\.js binary is missing|Missing required runtime configuration|release-preflight\.mjs failed/);
  });
});

test("deploy script names keep staging and production scoped to their ports", () => {
  const source = readFileSync(join(process.cwd(), "scripts", "ops", "deploy-service.mjs"), "utf8");
  assert.match(source, /deployService\(service/);
  assert.match(source, /stopService\(service/);
  assert.match(source, /validateTargetInWorktree/);
  assert(!source.includes("git reset --hard"));
});

test("production deploy requires an explicit current main target", () => {
  const source = readFileSync(join(process.cwd(), "scripts", "ops", "deploy-service.mjs"), "utf8");
  assert.match(source, /assertExplicitProductionTarget\(service, options\.target\)/);
  assert.match(source, /deploy:production requires an explicit --target commit/);
  assert.match(source, /assertProductionTargetMatchesMain\(service, config\.root, targetCommit\)/);
  assert.match(source, /rev-parse", "origin\/main"/);
  assert.match(source, /deploy:production target .* must match origin\/main/);
});

test("deploy validation happens before the live service is stopped", () => {
  const source = readFileSync(join(process.cwd(), "scripts", "ops", "deploy-service.mjs"), "utf8");
  assert(source.indexOf("await validateTargetInWorktree") < source.indexOf("stopService(service"));
  assert.match(source, /git", \["worktree", "add"/);
  assert.match(source, /createReleaseCandidateRoot/);
  assert.match(source, /createReleaseValidationWorktreeRoot/);
});

test("release artifact and validation worktree roots are isolated under service runtime", async () => {
  await withTempProject(async (root) => {
    const config = getServiceConfig("staging", { root });
    const candidate = createReleaseCandidateRoot(config, "abcdef1234567890", "deploy-id");
    const validation = createReleaseValidationWorktreeRoot(config, "abcdef1234567890", "deploy-id");
    assert(candidate.startsWith(join(config.runtimeDir, "releases")));
    assert(validation.startsWith(join(config.runtimeDir, "release-worktrees")));
    assert(candidate.includes("abcdef123456"));
    assert(validation.includes("abcdef123456"));
    assert.notEqual(candidate, validation);
    assert(!candidate.includes("data-staging"));
    assert(!candidate.includes("uploads-staging"));
    assert(!validation.includes("data-staging"));
    assert(!validation.includes("uploads-staging"));
    assert.equal(sameVolume(config.root, candidate), true);
    assert.equal(sameVolume(config.root, validation), true);
  });
});

test("release activation refuses simulated cross-volume artifact moves", async () => {
  await withTempProject(async (root) => {
    const config = getServiceConfig("staging", { root });
    const preparedRoot = join(config.runtimeDir, "releases", "cross-volume");
    seedPreparedArtifacts(preparedRoot, "new");
    seedPreparedArtifacts(config.root, "old");
    assert.throws(() => activatePreparedArtifacts(config, { root: preparedRoot }, "release", {
      volumeProvider: (path) => path.includes("cross-volume") ? "Z:\\" : "E:\\",
    }), /same volume/);
    assert.equal(readFileSync(join(config.root, ".next", "BUILD_ID"), "utf8"), "old");
    assert.equal(existsSync(join(config.root, "node_modules", "next", "dist", "bin", "next")), true);
  });
});

test("release activation refuses incomplete node_modules before moving old artifacts", async () => {
  await withTempProject(async (root) => {
    const config = getServiceConfig("staging", { root });
    const preparedRoot = join(config.runtimeDir, "releases", "incomplete-node-modules");
    seedPreparedArtifacts(preparedRoot, "new");
    seedPreparedArtifacts(config.root, "old");
    assert.equal(unlinkSync(join(preparedRoot, "node_modules", "@next", "env", "package.json")), undefined);
    assert.throws(() => activatePreparedArtifacts(config, { root: preparedRoot }, "release"), /@next\/env/);
    assert.equal(readFileSync(join(config.root, "node_modules", "@next", "env", "package.json"), "utf8"), "old");
    assert.equal(readFileSync(join(config.root, ".next", "BUILD_ID"), "utf8"), "old");
  });
});

test("release activation restores old artifacts when same-volume rename fails", async () => {
  await withTempProject(async (root) => {
    const config = getServiceConfig("staging", { root });
    const preparedRoot = join(config.runtimeDir, "releases", "rename-failure");
    seedPreparedArtifacts(preparedRoot, "new");
    seedPreparedArtifacts(config.root, "old");
    let movedOld = false;
    const rename = (source, target) => {
      if (source.endsWith(".next")) throw new Error("simulated same-volume activation failure");
      if (target.includes(".before-release-")) movedOld = true;
      return renameSyncForTest(source, target);
    };
    assert.throws(() => activatePreparedArtifacts(config, { root: preparedRoot }, "release", { rename }), /simulated/);
    assert.equal(movedOld, true);
    assert.equal(readFileSync(join(config.root, "node_modules", "next", "dist", "bin", "next"), "utf8"), "old");
    assert.equal(readFileSync(join(config.root, ".next", "BUILD_ID"), "utf8"), "old");
  });
});

test("release activation retries transient Windows artifact locks", async () => {
  await withTempProject(async (root) => {
    const config = getServiceConfig("staging", { root });
    const preparedRoot = join(config.runtimeDir, "releases", "transient-rename-lock");
    seedPreparedArtifacts(preparedRoot, "new");
    seedPreparedArtifacts(config.root, "old");
    let targetToOldAttempts = 0;
    const rename = (source, target) => {
      if (source.endsWith("node_modules") && target.includes(".before-release-")) {
        targetToOldAttempts += 1;
        if (targetToOldAttempts === 1) {
          const error = new Error("simulated transient EPERM while activating node_modules");
          error.code = "EPERM";
          throw error;
        }
      }
      return renameSyncForTest(source, target);
    };
    const state = activatePreparedArtifacts(config, { root: preparedRoot }, "release", {
      rename,
      renameAttempts: 2,
      renameDelayMs: 0,
    });
    assert.equal(targetToOldAttempts, 2);
    assert.equal(state.moved.length, 2);
    assert.equal(readFileSync(join(config.root, "node_modules", "@next", "env", "package.json"), "utf8"), "new");
    assert.equal(readFileSync(join(config.root, ".next", "BUILD_ID"), "utf8"), "new");
  });
});

test("deploy waits until stopped service artifacts can be renamed", async () => {
  await withTempProject(async (root) => {
    const port = await findAvailablePort();
    const config = getServiceConfig("staging", { root, port: String(port) });
    seedPreparedArtifacts(config.root, "old");
    let attempts = 0;
    const rename = (source, target) => {
      attempts += 1;
      if (attempts === 1 && source.endsWith("node_modules")) {
        const error = new Error("simulated EPERM while process releases node_modules");
        error.code = "EPERM";
        throw error;
      }
      return renameSyncForTest(source, target);
    };
    assert.equal(await waitForStoppedServiceArtifacts(config, {
      rename,
      intervalMs: 1,
      timeoutMs: 200,
    }), true);
    assert(attempts > 1);
    assert.equal(readFileSync(join(config.root, "node_modules", "@next", "env", "package.json"), "utf8"), "old");
    assert.equal(readFileSync(join(config.root, ".next", "BUILD_ID"), "utf8"), "old");
  });
});

test("deploy rechecks artifact writability after checkout before activation", () => {
  const source = readFileSync(join(process.cwd(), "scripts", "ops", "deploy-service.mjs"), "utf8");
  const checkoutIndex = source.indexOf('runSync("git", ["checkout", "--detach", targetCommit]');
  const activateIndex = source.indexOf("activatedRelease = writeActiveRelease(config", checkoutIndex);
  assert(checkoutIndex > 0);
  assert(activateIndex > checkoutIndex);
});

test("immutable release deploy path does not call legacy artifact activation helper", () => {
  const source = readFileSync(join(process.cwd(), "scripts", "ops", "deploy-service.mjs"), "utf8");
  const legacyDefinition = source.indexOf("export function activatePreparedArtifacts");
  const legacyCallBeforeDefinition = source.indexOf("activatePreparedArtifacts(");
  assert.match(source, /Deprecated legacy same-root activation path/);
  assert.equal(legacyCallBeforeDefinition, legacyDefinition + "export function ".length);
  assert.equal(source.indexOf("activatePreparedArtifacts(", legacyCallBeforeDefinition + 1), -1);
});

test("deploy skips full rollback until release artifacts are activated", () => {
  const source = readFileSync(join(process.cwd(), "scripts", "ops", "deploy-service.mjs"), "utf8");
  const catchIndex = source.indexOf("if (!options.dryRun && serviceStopped)");
  const restoreIndex = source.indexOf("restoreActiveRelease(config, previousActiveRelease);", catchIndex);
  const restartIndex = source.indexOf("previousArtifactsRestarted", catchIndex);
  assert(catchIndex > 0);
  assert(restoreIndex > catchIndex && restoreIndex < restartIndex);
});

test("deploy refuses activation when stopped service artifacts stay locked", async () => {
  await withTempProject(async (root) => {
    const port = await findAvailablePort();
    const config = getServiceConfig("staging", { root, port: String(port) });
    seedPreparedArtifacts(config.root, "old");
    await assertRejectsAsync(() => waitForStoppedServiceArtifacts(config, {
      rename: (source, target) => {
        if (source.endsWith("node_modules")) {
          const error = new Error("simulated persistent EPERM");
          error.code = "EPERM";
          throw error;
        }
        return renameSyncForTest(source, target);
      },
      intervalMs: 1,
      timeoutMs: 5,
    }), /did not release service artifacts/);
    assert.equal(readFileSync(join(config.root, "node_modules", "@next", "env", "package.json"), "utf8"), "old");
    assert.equal(readFileSync(join(config.root, ".next", "BUILD_ID"), "utf8"), "old");
  });
});

test("rollback code is prepared before service stop and no install runs while stopped", () => {
  const source = readFileSync(join(process.cwd(), "scripts", "ops", "deploy-service.mjs"), "utf8");
  const rollbackStart = source.indexOf("export async function rollbackService");
  const prepareIndex = source.indexOf("prepareRollbackCodeCandidate", rollbackStart);
  const stopIndex = source.indexOf("stopService(service", rollbackStart);
  const prepareFunctionIndex = source.indexOf("async function prepareRollbackCodeCandidate");
  assert(rollbackStart >= 0);
  assert(prepareIndex > rollbackStart && prepareIndex < stopIndex);
  const stoppedWindow = source.slice(stopIndex, prepareFunctionIndex);
  assert(!stoppedWindow.includes('await run("npm"'));
  assert(!stoppedWindow.includes('["npm", ["ci"]]'));
  assert(!stoppedWindow.includes('["npm", ["run", "build"]]'));
});

test("rollback CLI accepts authorization file and deployment id", () => {
  const source = readFileSync(join(process.cwd(), "scripts", "ops", "rollback-service.mjs"), "utf8");
  assert.match(source, /valueAfter\("--rollback-authorization-file"\)/);
  assert.match(source, /valueAfter\("--deployment-id"\)/);
  assert.match(source, /rollbackAuthorizationFile/);
  assert.match(source, /deploymentId/);
});

test("deploy verification installs dev tooling before production preflight", () => {
  const source = readFileSync(join(process.cwd(), "scripts", "ops", "deploy-service.mjs"), "utf8");
  assert.match(source, /buildVerificationEnv/);
  assert.match(source, /npm_config_production: "false"/);
  assert.match(source, /delete env\.STAGING_SMOKE_PORT/);
  assert.match(source, /args\.join\(" "\) === "run test:staging-smoke"/);
});

test("deploy validation passes the temporary root to preflight", () => {
  const source = readFileSync(join(process.cwd(), "scripts", "ops", "deploy-service.mjs"), "utf8");
  assert(source.includes('"scripts/ops/start-service.mjs", service, "--preflight-only", "--root", validationRoot'));
  assert.match(source, /buildReleaseCandidateVerificationEnv\(runtime\.env, validationScratchRoot/);
});

test("release candidate validation uses scratch data outside the artifact", async () => {
  await withTempProject(async (root) => {
    const config = getServiceConfig("production", { root });
    const candidateRoot = createReleaseCandidateRoot(config, "abcdef1234567890", "deploy-id");
    const scratchRoot = join(config.runtimeDir, "release-smoke", "candidate");
    const env = buildReleaseCandidateVerificationEnv({
      PORT: "3106",
      DATA_DIR: "data",
      UPLOADS_DIR: "uploads",
    }, scratchRoot, { includeRuntimeConfig: true });
    assert.equal(env.DATA_DIR, join(scratchRoot, "data"));
    assert.equal(env.UPLOADS_DIR, join(scratchRoot, "uploads"));
    assert.equal(resolve(env.DATA_DIR).startsWith(resolve(candidateRoot)), false);
    assert.equal(resolve(env.UPLOADS_DIR).startsWith(resolve(candidateRoot)), false);
  });
});

test("release artifact cleanliness rejects runtime state recursively", async () => {
  await withTempProject(async (root) => {
    const config = getServiceConfig("production", { root });
    const candidateRoot = createReleaseCandidateRoot(config, "abcdef1234567890", "dirty");
    seedPreparedArtifacts(candidateRoot, "new");
    mkdirSync(join(candidateRoot, "nested", "uploads"), { recursive: true });
    writeFileSync(join(candidateRoot, "nested", "uploads", "asset.txt"), "runtime upload");
    assert.throws(() => assertReleaseArtifactClean(candidateRoot), /uploads/);
    assert.equal(shouldExcludeFromReleaseArtifact(join(candidateRoot, "src", "data-model.ts"), { artifactRoot: candidateRoot }), false);
  });
});

test("generation endpoints are not used by health checks", () => {
  const source = readFileSync(join(process.cwd(), "scripts", "ops", "health-check.mjs"), "utf8");
  assert(!source.includes("/api/generate/"));
  assert(!source.includes("/api/upscale/"));
});

test("ops scripts support Windows paths with spaces and Chinese characters", async () => {
  await withTempProject(async (root) => {
    const config = getServiceConfig("staging", { root });
    assert(config.root.includes("中文"));
    assert.equal(config.dataDir, join(root, "data-staging"));
  });
});

test("service root resolution fails instead of falling back to cwd", async () => {
  await withTempProject(async (root) => {
    assert.throws(() => getKnownServiceRoot("staging", { root: join(root, "missing") }), /package.json/);
  });
});

test("task registration uses known service roots instead of the development worktree", () => {
  const source = readFileSync(join(process.cwd(), "scripts", "ops", "register-service-task.mjs"), "utf8");
  assert.match(source, /getKnownServiceRoot/);
  assert.match(source, /watchdog-service\.mjs/);
  assert(!source.includes("start-service.mjs"));
  assert.match(source, /watchdog-\$\{config\.service\}\.ps1/);
  assert.match(source, /watchdog-\$\{config\.service\}-hidden\.vbs/);
  assert.match(source, /wscript\.exe "\$\{hiddenLauncher\}"/);
  assert.match(source, /powershell\.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File/);
  assert.match(source, /Start-Process -FilePath \$node -ArgumentList \$arguments -WorkingDirectory \$root -WindowStyle Hidden -PassThru -Wait/);
  assert.match(source, /'--root', \$root/);
  assert.match(source, /-File/);
  assert.match(source, /\\uFEFF/);
  assert.match(source, /"MINUTE"/);
  assert.match(source, /"10"/);
});

test("deployment operations gate documents reviewable env, preflight, backup, rollback, and artifact checks", () => {
  const source = readFileSync(join(process.cwd(), "docs", "DEPLOYMENT_OPERATIONS_GATE.md"), "utf8");
  for (const fragment of [
    "E:\\codex工作台\\p003\\new-jiemian",
    "E:\\codex工作台\\p003\\new-jiemian-3107",
    "No real deployment, migration, restore, data cleanup, provider call, or NewAPI generation call",
    "AUTH_SESSION_SECRET",
    "SESSION_SECRET",
    "APP_DATABASE_URL",
    "APP_DATABASE_EXPECTED_NAME",
    "APP_AUTH_PERSISTENCE_MODE",
    "APP_BILLING_PERSISTENCE_MODE",
    "APP_TASK_BILLING_PERSISTENCE_MODE",
    "NEW_API_ENABLED",
    "NEW_API_BASE_URL",
    "NEW_API_ENVIRONMENT",
    "NEW_API_ADMIN_USER_ID",
    "NEW_API_ADMIN_ACCESS_TOKEN",
    "PAYMENT_PRODUCTION_ENABLED",
    "PAYMENT_PRODUCTION_WEBHOOK_SECRET",
    "node scripts/ops/load-runtime-env.mjs production --json",
    "npm run release:preflight",
    "npm run test:security-release",
    "npm run test:runtime-isolation",
    "npm run test:release-artifact-cleanliness",
    "npm run check:release-test-artifact-isolation",
    "npm run test:ops",
    "npm run test:rollback-drill",
    "npm run db:migration:rehearsal",
    "npm run db:import:dry-run",
    "npm run db:consistency:check",
    "npm run db:rollback:check",
    "pg_dump",
    "pg_restore --list",
    "No production migration is allowed from this gate alone.",
    "no `npm ci`, `npm install`, or `npm run build` runs while the live service is stopped",
    "Release artifacts must not contain",
    "CI runs release artifact cleanliness, release test artifact isolation, ops tests, and rollback drill",
  ]) {
    assert(source.includes(fragment), `deployment operations gate missing: ${fragment}`);
  }
});

function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

function seedPreparedArtifacts(root, marker) {
  mkdirSync(join(root, "node_modules", "next", "dist", "bin"), { recursive: true });
  mkdirSync(join(root, "node_modules", "@next", "env"), { recursive: true });
  mkdirSync(join(root, ".next", "server"), { recursive: true });
  mkdirSync(join(root, ".next", "static"), { recursive: true });
  writeFileSync(join(root, "node_modules", "next", "dist", "bin", "next"), marker);
  writeFileSync(join(root, "node_modules", "@next", "env", "package.json"), marker);
  writeFileSync(join(root, ".next", "BUILD_ID"), marker);
  writeFileSync(join(root, ".next", "required-server-files.json"), "{}");
  writeFileSync(join(root, ".next", "server", "index.js"), marker);
  writeFileSync(join(root, ".next", "static", "asset.js"), marker);
}

function renameSyncForTest(source, target) {
  return renameSync(source, target);
}

function writeOperationLock(config, values = {}) {
  writeFileSync(join(config.runtimeDir, `operation-${config.service}.lock`), JSON.stringify({
    lockVersion: 1,
    serviceName: config.service,
    operation: "deploy",
    pid: process.pid,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...values,
  }, null, 2));
}

async function assertRestoreFailurePreservesRuntime(label, exercise) {
  await withTempProject(async (root) => {
    await writeFile(join(root, "data", "library.json"), `runtime-data-${label}`);
    await writeFile(join(root, "uploads", "asset.txt"), `runtime-upload-${label}`);
    const config = getServiceConfig("production", { root });
    const backup = createServiceBackup(config, { note: `rollback failure ${label}` });
    await writeFile(join(root, "data", "library.json"), `mutated-data-${label}`);
    await writeFile(join(root, "data", "runtime-only.txt"), `runtime-only-${label}`);
    await writeFile(join(root, "uploads", "asset.txt"), `mutated-upload-${label}`);
    await writeFile(join(root, "uploads", "runtime-only.txt"), `runtime-upload-only-${label}`);
    const beforeData = snapshotDirectory(config.dataDir);
    const beforeUploads = snapshotDirectory(config.uploadsDir);
    await exercise({ root, config, backup });
    assert.deepEqual(snapshotDirectory(config.dataDir), beforeData);
    assert.deepEqual(snapshotDirectory(config.uploadsDir), beforeUploads);
  });
}

async function assertRejectsAsync(fn, pattern) {
  let rejected = null;
  try {
    await fn();
  } catch (error) {
    rejected = error;
  }
  assert(rejected, "Expected async function to reject.");
  assert.match(rejected.message, pattern);
}

for (const { name, fn } of tests) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error instanceof Error ? error.stack || error.message : String(error));
  }
}

console.log(`ops service tests: total=${tests.length} passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
