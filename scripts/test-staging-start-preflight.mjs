#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const tests = [];
let passed = 0;
let failed = 0;

const releaseEnv = {
  NODE_ENV: "production",
  RUNTIME_STORAGE_ISOLATION: "strict",
  AUTH_SESSION_SECRET: "staging-start-release-secret-32-chars",
  APP_DATABASE_URL: "postgresql://staging_user:staging_pass@127.0.0.1:5432/aohuang_app",
  APP_DATABASE_EXPECTED_NAME: "aohuang_app",
  APP_AUTH_PERSISTENCE_MODE: "postgres",
  APP_BILLING_PERSISTENCE_MODE: "postgres",
  APP_TASK_BILLING_PERSISTENCE_MODE: "postgres",
  NEW_API_ENABLED: "true",
  NEW_API_BASE_URL: "https://new-api.example.test",
  NEW_API_ENVIRONMENT: "production",
  NEW_API_ADMIN_USER_ID: "1",
  NEW_API_ADMIN_ACCESS_TOKEN: "staging-start-release-token",
  PAYMENT_PRODUCTION_ENABLED: "",
  PAYMENT_PRODUCTION_WEBHOOK_SECRET: "",
};

function test(name, fn) {
  tests.push({ name, fn });
}

function runStagingPreflightOnly(envPatch, options = {}) {
  return spawnSync(process.execPath, [
    "scripts/start-staging.mjs",
    "--preflight-only",
    ...(options.serviceRoot ? ["--root", options.serviceRoot] : []),
  ], {
    cwd: root,
    env: {
      ...process.env,
      ...releaseEnv,
      AOHUANG_ALLOW_RUNTIME_DIR_OVERRIDE: "1",
      PORT: "3107",
      ...envPatch,
    },
    encoding: "utf8",
    shell: false,
    maxBuffer: 20 * 1024 * 1024,
  });
}

async function withTempServiceRoot(fn) {
  const tempRoot = await mkdtemp(join(tmpdir(), "aohuang-staging-service-"));
  try {
    mkdirSync(join(tempRoot, ".runtime"), { recursive: true });
    await writeFile(join(tempRoot, "package.json"), "{}");
    return await fn(tempRoot);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function withTempDirs(fn) {
  const tempRoot = await mkdtemp(join(tmpdir(), "aohuang-staging-start-"));
  try {
    return await fn({
      dataDir: join(tempRoot, "data"),
      uploadsDir: join(tempRoot, "uploads"),
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function outputOf(result) {
  return `${result.stdout || ""}\n${result.stderr || ""}`;
}

function assertFails(result, pattern) {
  assert.notEqual(result.status, 0);
  assert.match(outputOf(result), pattern);
}

test("start:staging delegates to the staging launcher", () => {
  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(packageJson.scripts?.["start:staging"], "node scripts/start-staging.mjs");
});

test("staging launcher runs full release preflight before next start", () => {
  const script = readFileSync(join(root, "scripts", "start-staging.mjs"), "utf8");
  const opsScript = readFileSync(join(root, "scripts", "ops", "start-service.mjs"), "utf8");
  const preflightIndex = opsScript.indexOf("scripts/release-preflight.mjs");
  const nextStartIndex = opsScript.indexOf("nextBin");
  assert.match(script, /scripts\/ops\/start-service\.mjs/);
  assert.match(opsScript, /preflightOnly/);
  assert(preflightIndex >= 0, "release preflight command is missing");
  assert(nextStartIndex >= 0, "next start command is missing");
  assert(preflightIndex < nextStartIndex, "release preflight must run before next start");
});

test("start:staging preflight rejects missing database config", async () => {
  await withTempServiceRoot(async (serviceRoot) => {
    const result = runStagingPreflightOnly({ APP_DATABASE_URL: "" }, { serviceRoot });
    assertFails(result, /APP_DATABASE_URL|Missing required runtime configuration/);
  });
});

test("start:staging preflight rejects missing NewAPI config", async () => {
  await withTempServiceRoot(async (serviceRoot) => {
    const result = runStagingPreflightOnly({ NEW_API_ADMIN_ACCESS_TOKEN: "" }, { serviceRoot });
    assertFails(result, /NEW_API_ADMIN_ACCESS_TOKEN|Missing required runtime configuration/);
  });
});

test("start:staging preflight enforces staging storage paths", async () => {
  await withTempDirs(async ({ dataDir, uploadsDir }) => {
    const result = runStagingPreflightOnly({ DATA_DIR: dataDir, UPLOADS_DIR: uploadsDir });
    assert.equal(result.status, 0, outputOf(result));
  });
});

test("start:staging preflight passes with isolated temporary dirs", async () => {
  await withTempDirs(async ({ dataDir, uploadsDir }) => {
    const result = runStagingPreflightOnly({ DATA_DIR: dataDir, UPLOADS_DIR: uploadsDir });
    assert.equal(result.status, 0, outputOf(result));
  });
});

test("start:staging preflight runs backend release checks", async () => {
  await withTempDirs(async ({ dataDir, uploadsDir }) => {
    const result = runStagingPreflightOnly({
      DATA_DIR: dataDir,
      UPLOADS_DIR: uploadsDir,
      NEW_API_ENABLED: "false",
    });
    assertFails(result, /Backend release preflight failed|NEW_API_ENABLED/);
  });
});

test("normal npm start keeps the existing release preflight behavior", () => {
  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(packageJson.scripts?.start, "npm run release:preflight && next start -H 127.0.0.1");
});

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

console.log(`staging start preflight tests: total=${tests.length} passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
