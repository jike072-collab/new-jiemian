#!/usr/bin/env node
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { checkServiceHealth } from "./health-check.mjs";
import { rotateLogFile } from "./log-utils.mjs";
import { getServiceConfig } from "./service-config.mjs";
import { startService } from "./start-service.mjs";
import { stopService } from "./stop-service.mjs";
import { classifyServiceProcess } from "./process-identity.mjs";
import { wait } from "./process-utils.mjs";

export async function runWatchdog(service, options = {}) {
  const config = getServiceConfig(service, options);
  mkdirSync(config.runtimeDir, { recursive: true });
  const lock = acquireLock(config, options);
  try {
    const identity = await classifyServiceProcess(service, { root: config.root, port: config.port, processInfoProvider: options.processInfoProvider });
    if (identity.status === "owned") {
      const health = await checkServiceHealth(service, { root: config.root, port: config.port, repeat: 1, timeoutMs: options.timeoutMs || 5000 });
      if (health.ok) {
        writeWatchdogLog(config, "healthy", { pid: identity.pid });
        return { service, action: "none", ok: true, identity: identity.status, health };
      }
      const stableFailure = await confirmHealthFailure(service, config, options);
      if (!stableFailure) return { service, action: "none", ok: true, identity: identity.status, transient: true };
      await stopService(service, { root: config.root });
      await wait(1500);
      const started = await startService(service, { root: config.root });
      await wait(1500);
      const after = await checkServiceHealth(service, { root: config.root, port: config.port, repeat: 3, timeoutMs: options.timeoutMs || 5000 });
      if (!after.ok) throw new Error(`${service} watchdog restart did not recover health.`);
      writeWatchdogLog(config, "restarted-unhealthy-owned", { pid: started.pid });
      return { service, action: "restart", ok: true, identity: identity.status, health: after };
    }
    if (["stopped", "stale"].includes(identity.status)) {
      const started = await startService(service, { root: config.root });
      await wait(1500);
      const health = await checkServiceHealth(service, { root: config.root, port: config.port, repeat: 3, timeoutMs: options.timeoutMs || 5000 });
      if (!health.ok) throw new Error(`${service} watchdog start did not recover health.`);
      writeWatchdogLog(config, "started", { pid: started.pid, previous: identity.status });
      return { service, action: "start", ok: true, identity: identity.status, health };
    }
    writeWatchdogLog(config, "refused", { identity: identity.status, reason: identity.reason });
    throw new Error(`${service} watchdog refused: process identity is ${identity.status} (${identity.reason}).`);
  } finally {
    releaseLock(lock);
  }
}

async function confirmHealthFailure(service, config, options) {
  for (let index = 0; index < 3; index += 1) {
    const health = await checkServiceHealth(service, { root: config.root, port: config.port, repeat: 1, timeoutMs: options.timeoutMs || 5000 });
    if (health.ok) return false;
    await wait(500);
  }
  return true;
}

function acquireLock(config, options = {}) {
  const lockFile = join(config.runtimeDir, `watchdog-${config.service}.lock`);
  const staleMs = Number(options.staleMs || 5 * 60 * 1000);
  if (existsSync(lockFile) && Date.now() - statSync(lockFile).mtimeMs > staleMs) rmSync(lockFile, { force: true });
  const fd = openSync(lockFile, "wx");
  return { fd, lockFile };
}

function releaseLock(lock) {
  closeSync(lock.fd);
  rmSync(lock.lockFile, { force: true });
}

function writeWatchdogLog(config, event, fields = {}) {
  const logFile = join(config.runtimeDir, `watchdog-${config.service}.log`);
  rotateLogFile(logFile, { maxBytes: 1024 * 1024, keep: 7 });
  appendFileSync(logFile, JSON.stringify({ at: new Date().toISOString(), service: config.service, event, ...fields }) + "\n");
}

async function cli() {
  const service = process.argv[2];
  const root = valueAfter("--root");
  const result = await runWatchdog(service, { root });
  console.log(JSON.stringify(result, null, 2));
}

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  cli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
