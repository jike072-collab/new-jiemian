#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";

import { snapshotDirectory } from "./ops/backup-utils.mjs";
import { getServiceConfig } from "./ops/service-config.mjs";

const host = "127.0.0.1";
const defaultTimeoutMs = 10000;
const startupTimeoutMs = 45000;

export const studioModeRoutes = [
  { tool: "image", label: "图片生成" },
  { tool: "image-editor", label: "图片编辑" },
  { tool: "video", label: "视频生成" },
  { tool: "image-upscale", label: "图片高清" },
  { tool: "video-upscale", label: "视频高清" },
  { tool: "library", label: "作品库" },
];

export const htmlErrorMarkers = [
  "Application error:",
  "Internal Server Error",
  "Minified React error",
  "Hydration failed",
  "ChunkLoadError",
];

const forbiddenRequestPatterns = [
  /\/api\/generate\//,
  /\/api\/upscale\/(?:image|video)$/,
  /\/api\/prompts\/optimize$/,
  /\/api\/quota\/precheck$/,
  /new-api/i,
];

export function fail(message) {
  throw new Error(message);
}

export function sameSnapshot(before, after) {
  return before.exists === after.exists
    && before.count === after.count
    && before.size === after.size
    && before.sha256 === after.sha256;
}

export function assertNoHtmlErrors(name, text) {
  for (const marker of htmlErrorMarkers) {
    if (text.includes(marker)) {
      fail(`${name} contains runtime error marker: ${marker}`);
    }
  }
}

export function assertNoForbiddenRequests(requests) {
  const blocked = requests.filter((request) => forbiddenRequestPatterns.some((pattern) => pattern.test(request)));
  if (blocked.length) {
    fail(`forbidden generation or NewAPI request observed: ${blocked.join(", ")}`);
  }
}

export async function fetchResource(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || defaultTimeoutMs);
  try {
    const response = await fetch(url, {
      redirect: options.redirect || "follow",
      signal: controller.signal,
    });
    return {
      url,
      status: response.status,
      text: options.readText === false ? "" : await response.text(),
    };
  } finally {
    clearTimeout(timer);
  }
}

export function extractScriptUrls(html, baseUrl) {
  const matches = html.matchAll(/<script[^>]+src="([^"]+)"/g);
  return [...new Set([...matches].map((match) => new URL(match[1], baseUrl).toString()))];
}

export async function fetchTracked(requests, baseUrl, path, options = {}) {
  const url = path.startsWith("http") ? path : `${baseUrl}${path}`;
  const parsed = new URL(url);
  requests.push(`${options.method || "GET"} ${parsed.pathname}${parsed.search}`);
  return fetchResource(url, options);
}

export async function withStudioTestTarget(callback, options = {}) {
  if (process.env.STUDIO_TEST_MANAGE_SERVER === "1") {
    return withManagedStudioServer(callback, options);
  }

  const explicitBaseUrl = process.env.STUDIO_TEST_BASE_URL || options.baseUrl;
  if (explicitBaseUrl) {
    return callback({
      baseUrl: explicitBaseUrl.replace(/\/$/, ""),
      dataBefore: null,
      uploadsBefore: null,
      dataAfter: null,
      uploadsAfter: null,
      managed: false,
      tempRoot: null,
    });
  }

  const config = getServiceConfig("staging");
  const dataBefore = snapshotDirectory(config.dataDir);
  const uploadsBefore = snapshotDirectory(config.uploadsDir);
  const result = await callback({
    baseUrl: `http://${host}:${config.port}`,
    dataBefore,
    uploadsBefore,
    dataAfter: null,
    uploadsAfter: null,
    managed: false,
    tempRoot: null,
  });
  const dataAfter = snapshotDirectory(config.dataDir);
  const uploadsAfter = snapshotDirectory(config.uploadsDir);
  if (!sameSnapshot(dataBefore, dataAfter)) fail("data-staging changed during UI acceptance.");
  if (!sameSnapshot(uploadsBefore, uploadsAfter)) fail("uploads-staging changed during UI acceptance.");
  return result;
}

async function withManagedStudioServer(callback, options = {}) {
  const root = process.cwd();
  const requestedPort = Number(process.env.STUDIO_TEST_PORT || process.env.STAGING_SMOKE_PORT || options.port || "43107");
  assertSafePort(requestedPort);
  if (!existsSync(join(root, ".next"))) fail("Missing .next build output. Run npm run build first.");
  if (!await portAvailable(requestedPort)) {
    fail(`Port ${requestedPort} is already in use; refusing to test another service.`);
  }

  const tempRoot = await mkdtemp(join(tmpdir(), "aohuang-studio-ui-"));
  const dataDir = join(tempRoot, "data");
  const uploadsDir = join(tempRoot, "uploads");
  let child;

  try {
    const env = buildManagedEnv(requestedPort, dataDir, uploadsDir);
    child = spawn(process.execPath, ["scripts/ops/start-service.mjs", "staging", "--foreground", "--root", root], {
      cwd: root,
      env,
      detached: process.platform !== "win32",
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => process.stdout.write(chunk));
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));

    await waitForHttp(`http://${host}:${requestedPort}/api/health/backend`);
    if (!(await stat(dataDir)).isDirectory()) fail("temporary DATA_DIR was not created.");
    if (!(await stat(uploadsDir)).isDirectory()) fail("temporary UPLOADS_DIR was not created.");

    const dataBefore = snapshotDirectory(dataDir);
    const uploadsBefore = snapshotDirectory(uploadsDir);
    const result = await callback({
      baseUrl: `http://${host}:${requestedPort}`,
      dataBefore,
      uploadsBefore,
      dataAfter: null,
      uploadsAfter: null,
      managed: true,
      tempRoot,
    });
    const dataAfter = snapshotDirectory(dataDir);
    const uploadsAfter = snapshotDirectory(uploadsDir);
    if (!sameSnapshot(dataBefore, dataAfter)) fail("temporary data directory changed during UI acceptance.");
    if (!sameSnapshot(uploadsBefore, uploadsAfter)) fail("temporary uploads directory changed during UI acceptance.");
    return result;
  } finally {
    if (child) await stopProcess(child);
    await rm(tempRoot, { recursive: true, force: true });
    if (existsSync(tempRoot)) fail("temporary directory cleanup failed.");
  }
}

function buildManagedEnv(port, dataDir, uploadsDir) {
  return {
    ...process.env,
    PORT: String(port),
    STAGING_PORT: String(port),
    AOHUANG_ALLOW_RUNTIME_DIR_OVERRIDE: "1",
    RUNTIME_STORAGE_ISOLATION: "strict",
    DATA_DIR: dataDir,
    UPLOADS_DIR: uploadsDir,
    NEW_API_ENABLED: "true",
    AUTH_SESSION_SECRET: "studio-regression-auth-secret-32-chars",
    APP_DATABASE_URL: "postgresql://studio_user:studio_pass@127.0.0.1:5432/aohuang_app",
    APP_DATABASE_EXPECTED_NAME: "aohuang_app",
    APP_AUTH_PERSISTENCE_MODE: "postgres",
    APP_BILLING_PERSISTENCE_MODE: "postgres",
    APP_TASK_BILLING_PERSISTENCE_MODE: "postgres",
    NEW_API_BASE_URL: "https://new-api.example.test",
    NEW_API_ENVIRONMENT: "production",
    NEW_API_ADMIN_USER_ID: "1",
    NEW_API_ADMIN_ACCESS_TOKEN: "studio-regression-admin-token",
  };
}

function assertSafePort(port) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    fail("STUDIO_TEST_PORT must be an integer between 1024 and 65535.");
  }
}

function portAvailable(port) {
  return new Promise((resolvePort) => {
    const server = net.createServer();
    server.once("error", () => resolvePort(false));
    server.listen(port, host, () => server.close(() => resolvePort(true)));
  });
}

async function waitForHttp(url) {
  const startedAt = Date.now();
  let lastError = "";
  while (Date.now() - startedAt < startupTimeoutMs) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return response;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await wait(500);
  }
  throw new Error(`service did not respond before timeout: ${lastError}`);
}

function wait(ms) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
  await Promise.race([
    new Promise((resolveStop) => child.once("exit", resolveStop)),
    wait(5000).then(() => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      if (process.platform === "win32") {
        spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
        return;
      }
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }),
  ]);
}
