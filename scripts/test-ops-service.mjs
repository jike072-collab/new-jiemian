#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";
import { buildRuntimeEnv, formatRuntimeEnvSummary } from "./ops/load-runtime-env.mjs";
import { getKnownServiceRoot, getServiceConfig } from "./ops/service-config.mjs";
import { getServiceStatus } from "./ops/service-status.mjs";
import { createServiceBackup, restoreDataAndUploads, snapshotDirectory, verifyBackupManifest, writeRollbackScript } from "./ops/backup-utils.mjs";
import { createDatabaseBackup, createDatabaseFingerprint } from "./ops/database-backup.mjs";
import { createDatabaseRestoreAuthorization, prepareDatabaseRestore, restoreDatabaseBackup } from "./ops/database-restore.mjs";
import { classifyServiceProcess, createCommandFingerprint } from "./ops/process-identity.mjs";
import { stopService } from "./ops/stop-service.mjs";
import { runWatchdog } from "./ops/watchdog-service.mjs";

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
    assert.match(summary, /AUTH_SESSION_SECRET: configured \(masked/);
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
        dataDir: config.dataDir,
        uploadsDir: config.uploadsDir,
        command: `node ${join(config.root, "node_modules", "next", "dist", "bin", "next")} start -H 127.0.0.1 -p ${config.port}`,
        processStartedAt: "2026-06-25T00:00:00.000Z",
      }, null, 2));
      const identity = await classifyServiceProcess("staging", {
        root,
        port: config.port,
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
    });
    assert.equal(authorization.used, false);
    restoreDatabaseBackup(config, manifest, env, {
      pgRestoreCommand: [process.execPath, fakeRestore],
      rollbackAuthorization: authorization,
      expectedTargetCommit: "target-commit",
    });
    assert.equal(authorization.used, true);
    assert.throws(() => prepareDatabaseRestore(config, manifest, env, {
      pgRestoreCommand: [process.execPath, fakeRestore],
      rollbackAuthorization: authorization,
      expectedTargetCommit: "target-commit",
    }), /already been used/);
    assert(!JSON.stringify(authorization).includes("example_password"));
    assert(!JSON.stringify(authorization).includes("postgresql://"));
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

test("deploy script names keep staging and production scoped to their ports", () => {
  const source = readFileSync(join(process.cwd(), "scripts", "ops", "deploy-service.mjs"), "utf8");
  assert.match(source, /deployService\(service/);
  assert.match(source, /stopService\(service/);
  assert.match(source, /validateTargetInWorktree/);
  assert(!source.includes("git reset --hard"));
});

test("deploy validation happens before the live service is stopped", () => {
  const source = readFileSync(join(process.cwd(), "scripts", "ops", "deploy-service.mjs"), "utf8");
  assert(source.indexOf("await validateTargetInWorktree") < source.indexOf("stopService(service"));
  assert.match(source, /git", \["worktree", "add"/);
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
  assert.match(source, /powershell\.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File/);
  assert.match(source, /--root \$root/);
  assert.match(source, /-File/);
  assert.match(source, /\\uFEFF/);
  assert.match(source, /"MINUTE"/);
  assert.match(source, /"1"/);
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
