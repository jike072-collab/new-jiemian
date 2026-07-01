#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const tempRoot = mkdtempSync(join(tmpdir(), "aohuang-local-readiness-"));
const dataDir = join(tempRoot, "data");
const uploadsDir = join(tempRoot, "uploads");
const runtimeDir = join(tempRoot, "runtime");
const testPassword = "local-readiness-password-not-secret";
const testToken = "local-readiness-token-not-secret";
const testAk = "local-readiness-ak-not-secret";
const testSk = "local-readiness-sk-not-secret";
const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
const startedPids = new Set();
let app;
let stdout = "";
let stderr = "";
let appStopped = false;

try {
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(uploadsDir, { recursive: true });
  mkdirSync(runtimeDir, { recursive: true });

  app = spawn(process.execPath, [
    "node_modules/next/dist/bin/next",
    "start",
    "-H",
    "127.0.0.1",
    "-p",
    String(port),
  ], {
    cwd: root,
    env: isolatedEnv(),
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  startedPids.add(app.pid);
  app.stdout.on("data", (chunk) => {
    stdout += chunk.toString("utf8");
  });
  app.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  await waitForHttp(`${baseUrl}/api/health/backend`);
  await assertLoopbackOnly();

  const health = await fetchJson("/api/health/backend");
  assert.equal(health.status, 200);
  assert.equal(health.body.ok, true);
  assert.equal(health.body.service, "backend");
  assert.equal(health.body.checks.providerHealth.liveGenerationEnabled, false);

  runChecked("npm", ["run", "test:abuse-guard-contracts"], {
    RUNTIME_DIR: runtimeDir,
  });

  runChecked("npm", ["run", "test:upload-temp-cleanup"], {
    RUNTIME_DIR: runtimeDir,
  });
  runChecked("npm", ["run", "test:ops"], {
    RUNTIME_DIR: runtimeDir,
  });
  runChecked("npm", ["run", "test:log-redaction"], {
    RUNTIME_DIR: runtimeDir,
  });

  await stopApp();
  await assertNoStartedNodeProcesses();
  assertNoSensitiveLogOutput(stdout + stderr);

  console.log(JSON.stringify({
    ok: true,
    port,
    bindHost: "127.0.0.1",
    health: "PASS",
    protectedApiRejected: "PASS",
    adminUnauthorizedRejected: "PASS",
    oversizedVideoRejectedBeforeBuffer: "PASS",
    illegalMediaTypeRejected: "PASS",
    storage85BlocksVideoWrites: "PASS",
    storage90BlocksMediaWrites: "PASS",
    readAndDownloadAllowedUnderStorageProtection: "PASS",
    freshMediaPreserved: "PASS",
    expiredMediaCleaned: "PASS",
    queuedAndGeneratingPreserved: "PASS",
    cleanupPathEscapeRefused: "PASS",
    logRedaction: "PASS",
    nodeProcessCleanup: "PASS",
    realProviderCalled: false,
    productionDatabaseConnected: false,
  }, null, 2));
} finally {
  await stopApp().catch(() => undefined);
  rmSync(tempRoot, { recursive: true, force: true });
}

function isolatedEnv(overrides = {}) {
  return {
    ...process.env,
    NODE_ENV: "test",
    PORT: String(port),
    APP_BIND_HOST: "127.0.0.1",
    DATA_DIR: dataDir,
    UPLOADS_DIR: uploadsDir,
    RUNTIME_DIR: runtimeDir,
    RUNTIME_STORAGE_ISOLATION: "strict",
    AOHUANG_ALLOW_RUNTIME_DIR_OVERRIDE: "1",
    APP_AUTH_PERSISTENCE_MODE: "json",
    LIBRARY_STORAGE_BACKEND: "json",
    GENERATION_JOBS_BACKEND: "existing",
    DATABASE_LIBRARY_DUAL_WRITE: "false",
    DATABASE_LIBRARY_READ_ENABLED: "false",
    DATABASE_JOBS_WRITE_ENABLED: "false",
    APP_DATABASE_URL: "",
    APP_DATABASE_EXPECTED_NAME: "",
    NEW_API_ENABLED: "false",
    NEW_API_ENVIRONMENT: "test",
    NEW_API_BASE_URL: "http://127.0.0.1:9",
    NEW_API_ADMIN_USER_ID: "",
    NEW_API_ADMIN_ACCESS_TOKEN: testToken,
    PAYMENT_PRODUCTION_ENABLED: "false",
    PAYMENT_PRODUCTION_WEBHOOK_SECRET: "",
    PAYMENT_SANDBOX_WEBHOOK_SECRET: "",
    ADMIN_PASSWORD: testPassword,
    AUTH_SESSION_SECRET: "local-readiness-session-secret-000000000000",
    VOLCENGINE_ACCESS_KEY_PAIR: "",
    VOLCENGINE_ACCESS_KEY_ID: testAk,
    VOLCENGINE_SECRET_ACCESS_KEY: testSk,
    VOLCENGINE_IMAGEX_SERVICE_ID: "",
    VOLCENGINE_IMAGEX_OUTPUT_DOMAIN: "",
    VOLCENGINE_VOD_SPACE_NAME: "",
    VOLCENGINE_VOD_OUTPUT_DOMAIN: "",
    ...overrides,
  };
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  assert(address && typeof address === "object");
  return address.port;
}

async function waitForHttp(url) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 45000) {
    if (app?.exitCode !== null) break;
    try {
      const response = await fetch(url);
      if (response.status > 0) return;
    } catch {
      await sleep(500);
    }
  }
  throw new Error(`local production app did not become ready. stdout=${redact(stdout)} stderr=${redact(stderr)}`);
}

async function fetchJson(path) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { "x-request-id": "local-readiness" },
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

async function fetchRaw(path) {
  return fetch(`${baseUrl}${path}`, {
    headers: { "x-request-id": "local-readiness" },
  });
}

async function assertLoopbackOnly() {
  const local = await fetchRaw("/api/health/backend");
  assert.equal(local.status, 200);
  try {
    await fetch(`http://127.0.0.2:${port}/api/health/backend`, { signal: AbortSignal.timeout(1000) });
    assert.fail("server accepted non-127.0.0.1 loopback connection");
  } catch (error) {
    assert.notEqual(error?.name, "AssertionError");
  }
}

function runChecked(command, args, envOverrides = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: childTestEnv(envOverrides),
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  assertNoSensitiveLogOutput(`${result.stdout || ""}${result.stderr || ""}`);
  assert.equal(result.status, 0, `${command} ${args.join(" ")} failed\nstdout:\n${redact(result.stdout)}\nstderr:\n${redact(result.stderr)}`);
}

function childTestEnv(overrides = {}) {
  return {
    ...process.env,
    APP_DATABASE_URL: "",
    APP_DATABASE_EXPECTED_NAME: "",
    NEW_API_ENABLED: "false",
    NEW_API_ENVIRONMENT: "test",
    NEW_API_BASE_URL: "http://127.0.0.1:9",
    NEW_API_ADMIN_USER_ID: "",
    NEW_API_ADMIN_ACCESS_TOKEN: testToken,
    PAYMENT_PRODUCTION_ENABLED: "false",
    PAYMENT_PRODUCTION_WEBHOOK_SECRET: "",
    PAYMENT_SANDBOX_WEBHOOK_SECRET: "",
    VOLCENGINE_ACCESS_KEY_PAIR: "",
    VOLCENGINE_ACCESS_KEY_ID: testAk,
    VOLCENGINE_SECRET_ACCESS_KEY: testSk,
    VOLCENGINE_IMAGEX_SERVICE_ID: "",
    VOLCENGINE_IMAGEX_OUTPUT_DOMAIN: "",
    VOLCENGINE_VOD_SPACE_NAME: "",
    VOLCENGINE_VOD_OUTPUT_DOMAIN: "",
    ...overrides,
  };
}

async function stopApp() {
  if (appStopped || !app || app.exitCode !== null) {
    appStopped = true;
    return;
  }
  app.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise((resolve) => app.once("exit", resolve)),
    sleep(5000).then(() => false),
  ]);
  if (exited === false && app.exitCode === null) {
    app.kill("SIGKILL");
    await new Promise((resolve) => app.once("exit", resolve));
  }
  appStopped = true;
}

async function assertNoStartedNodeProcesses() {
  await sleep(500);
  for (const pid of startedPids) {
    if (!pid) continue;
    try {
      process.kill(pid, 0);
      assert.fail(`started Node process is still running: ${pid}`);
    } catch (error) {
      if (error?.code === "ESRCH") continue;
      if (error?.name === "AssertionError") throw error;
    }
  }
}

function assertNoSensitiveLogOutput(text) {
  for (const value of [testPassword, testToken, testAk, testSk]) {
    assert.equal(String(text).includes(value), false, `test secret leaked in logs: ${value}`);
  }
}

function redact(value) {
  return String(value || "")
    .replaceAll(testPassword, "[redacted]")
    .replaceAll(testToken, "[redacted]")
    .replaceAll(testAk, "[redacted]")
    .replaceAll(testSk, "[redacted]");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
