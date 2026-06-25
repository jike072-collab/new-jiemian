#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";
import { buildRuntimeEnv, formatRuntimeEnvSummary } from "./ops/load-runtime-env.mjs";
import { getServiceConfig } from "./ops/service-config.mjs";
import { getServiceStatus } from "./ops/service-status.mjs";
import { createServiceBackup, snapshotDirectory, writeRollbackScript } from "./ops/backup-utils.mjs";

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

test("deploy verification installs dev tooling before production preflight", () => {
  const source = readFileSync(join(process.cwd(), "scripts", "ops", "deploy-service.mjs"), "utf8");
  assert.match(source, /buildVerificationEnv/);
  assert.match(source, /npm_config_production: "false"/);
  assert.match(source, /delete env\.STAGING_SMOKE_PORT/);
  assert.match(source, /args\.join\(" "\) === "run test:staging-smoke"/);
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

test("task registration uses known service roots instead of the development worktree", () => {
  const source = readFileSync(join(process.cwd(), "scripts", "ops", "register-service-task.mjs"), "utf8");
  assert.match(source, /getKnownServiceRoot/);
  assert.match(source, /start-service\.mjs/);
  assert.match(source, /watchdog-\$\{config\.service\}\.ps1/);
  assert.match(source, /-File/);
  assert(!source.includes("-Command"));
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
