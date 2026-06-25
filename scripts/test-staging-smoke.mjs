#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import net from "node:net";

const root = process.cwd();
const requestedPort = Number(process.env.STAGING_SMOKE_PORT || "3107");
const host = "127.0.0.1";
const timeoutMs = 45000;

function log(message) {
  console.log(`[staging-smoke] ${message}`);
}

function fail(message) {
  console.error(`[staging-smoke] ${message}`);
  process.exit(1);
}

function assertSafePort(port) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    fail("STAGING_SMOKE_PORT must be an integer between 1024 and 65535.");
  }
}

function portAvailable(port) {
  return new Promise((resolvePort) => {
    const server = net.createServer();
    server.once("error", () => resolvePort(false));
    server.listen(port, host, () => server.close(() => resolvePort(true)));
  });
}

function wait(ms) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

async function waitForHttp(url) {
  const startedAt = Date.now();
  let lastError = "";
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      return response;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await wait(500);
    }
  }
  throw new Error(`service did not respond before timeout: ${lastError}`);
}

async function fetchStatus(path) {
  const response = await fetch(`http://${host}:${requestedPort}${path}`, { redirect: "manual" });
  return response.status;
}

function spawnNext(env) {
  return spawn(process.execPath, ["scripts/start-staging.mjs"], {
    cwd: root,
    env,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveStop) => child.once("exit", resolveStop)),
    wait(5000).then(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }),
  ]);
}

assertSafePort(requestedPort);
if (!existsSync(join(root, ".next"))) {
  fail("Missing .next build output. Run npm run build first.");
}
if (!await portAvailable(requestedPort)) {
  fail(`Port ${requestedPort} is already in use; refusing to smoke-test another service.`);
}

const tempRoot = await mkdtemp(join(tmpdir(), "aohuang-staging-smoke-"));
const dataDir = join(tempRoot, "data");
const uploadsDir = join(tempRoot, "uploads");
const defaultDataBefore = existsSync(join(root, "data"));
const defaultUploadsBefore = existsSync(join(root, "uploads"));
let child;

try {
  const env = {
    ...process.env,
    PORT: String(requestedPort),
    AOHUANG_ALLOW_RUNTIME_DIR_OVERRIDE: "1",
    RUNTIME_STORAGE_ISOLATION: "strict",
    DATA_DIR: dataDir,
    UPLOADS_DIR: uploadsDir,
    NEW_API_ENABLED: "true",
    AUTH_SESSION_SECRET: "staging-smoke-auth-session-secret-32-chars",
    APP_DATABASE_URL: "postgresql://staging_user:staging_pass@127.0.0.1:5432/aohuang_app",
    APP_DATABASE_EXPECTED_NAME: "aohuang_app",
    APP_AUTH_PERSISTENCE_MODE: "postgres",
    APP_BILLING_PERSISTENCE_MODE: "postgres",
    APP_TASK_BILLING_PERSISTENCE_MODE: "postgres",
    NEW_API_BASE_URL: "https://new-api.example.test",
    NEW_API_ENVIRONMENT: "production",
    NEW_API_ADMIN_USER_ID: "1",
    NEW_API_ADMIN_ACCESS_TOKEN: "staging-smoke-admin-token",
  };
  child = spawnNext(env);
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));

  const health = await waitForHttp(`http://${host}:${requestedPort}/api/health/backend`);
  const results = {
    home: await fetchStatus("/"),
    login: await fetchStatus("/login"),
    adminProviders: await fetchStatus("/admin/providers"),
    health: health.status,
  };

  if (results.home >= 500) throw new Error(`home returned ${results.home}`);
  if (results.login >= 500) throw new Error(`login returned ${results.login}`);
  if (![200, 302, 303, 307, 401, 403].includes(results.adminProviders)) {
    throw new Error(`admin providers returned unexpected status ${results.adminProviders}`);
  }
  if (results.health !== 200) throw new Error(`health returned ${results.health}`);
  if (!(await stat(dataDir)).isDirectory()) throw new Error("temporary DATA_DIR was not created.");
  if (!(await stat(uploadsDir)).isDirectory()) throw new Error("temporary UPLOADS_DIR was not created.");
  if (existsSync(join(root, "data")) !== defaultDataBefore) throw new Error("default data directory state changed.");
  if (existsSync(join(root, "uploads")) !== defaultUploadsBefore) throw new Error("default uploads directory state changed.");

  log(`home status: ${results.home}`);
  log(`login status: ${results.login}`);
  log(`admin providers status: ${results.adminProviders}`);
  log(`health status: ${results.health}`);
  log("generation APIs were not called; NewAPI quota was not consumed.");
  log(`temporary directory entries: ${(await readdir(tempRoot)).join(", ")}`);
} finally {
  if (child) await stopProcess(child);
  await rm(tempRoot, { recursive: true, force: true });
}

if (existsSync(tempRoot)) fail("temporary directory cleanup failed.");
log("test process stopped and temporary directory cleaned.");
log(`data default existed before=${defaultDataBefore} after=${existsSync(resolve(root, "data"))}`);
log(`uploads default existed before=${defaultUploadsBefore} after=${existsSync(resolve(root, "uploads"))}`);
