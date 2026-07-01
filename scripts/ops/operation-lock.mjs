import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { classifyServiceProcess } from "./process-identity.mjs";
import { getProcessInfo } from "./process-utils.mjs";

const DEFAULT_STALE_MS = 30 * 60 * 1000;
const knownOperations = new Set(["backup", "deploy", "rollback", "backup_failed", "deploy_failed", "rollback_failed"]);

export async function acquireServiceOperationLock(config, operation, details = {}, options = {}) {
  mkdirSync(config.runtimeDir, { recursive: true });
  const lockFile = lockPath(config, operation);
  if (options.existingLock) return { ...options.existingLock, shared: true, ownerLock: options.existingLock };
  await cleanupStaleServiceOperationLock(config, options);
  const fd = openSync(lockFile, "wx");
  const payload = {
    lockVersion: 1,
    serviceName: config.service,
    operation,
    pid: process.pid,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    processStartedAt: getProcessInfo(process.pid)?.CreationDate || null,
    ...details,
  };
  writeFileSync(fd, JSON.stringify(payload, null, 2));
  return { fd, lockFile, payload };
}

export function releaseServiceOperationLock(lock) {
  if (!lock) return;
  if (lock.shared) return;
  if (lock.failed) {
    closeSync(lock.fd);
    return;
  }
  try {
    closeSync(lock.fd);
  } finally {
    rmSync(lock.lockFile, { force: true });
  }
}

export function markServiceOperationFailed(config, lock, error) {
  if (!lock) return null;
  const ownerLock = lock.ownerLock || lock;
  const payload = {
    ...(lock.payload || {}),
    operation: `${lock.payload?.operation || "operation"}_failed`,
    failedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    error: error instanceof Error ? error.message : String(error),
  };
  writeFileSync(lock.lockFile, JSON.stringify(payload, null, 2));
  ownerLock.failed = true;
  ownerLock.payload = payload;
  return { ...lock, failed: true, payload };
}

export function touchServiceOperationLock(lock) {
  if (!lock?.lockFile || !lock.payload || lock.shared) return null;
  const payload = { ...lock.payload, updatedAt: new Date().toISOString() };
  writeFileSync(lock.lockFile, JSON.stringify(payload, null, 2));
  lock.payload = payload;
  return payload;
}

export async function getActiveServiceOperation(config, operations = ["deploy", "rollback"], options = {}) {
  const lockFile = lockPath(config, operations[0] || "deploy");
  if (!existsSync(lockFile)) return null;
  const status = await classifyOperationLock(config, lockFile, options);
  if (status.status === "stale") return null;
  return {
    operation: status.details?.operation || operations[0] || "deploy",
    lockFile,
    details: status.details || null,
    status: status.status,
    reason: status.reason,
  };
}

export async function cleanupStaleServiceOperationLock(config, options = {}) {
  const lockFile = lockPath(config);
  if (!existsSync(lockFile)) return null;
  const status = await classifyOperationLock(config, lockFile, options);
  if (status.status !== "stale") {
    throw new Error(`Service operation lock is ${status.status}; refusing to remove it automatically (${status.reason}).`);
  }
  rmSync(lockFile, { force: true });
  return status;
}

export async function classifyOperationLock(config, lockFile = lockPath(config), options = {}) {
  try {
    const details = JSON.parse(readFileSync(lockFile, "utf8"));
    if ((details.serviceName || details.service) !== config.service) {
      return { status: "unknown", reason: "service-mismatch", details, lockFile };
    }
    if (!knownOperations.has(details.operation)) {
      return { status: "unknown", reason: "unknown-operation", details, lockFile };
    }
    if (details.operation === "backup_failed" || details.operation === "rollback_failed" || details.operation === "deploy_failed") {
      return { status: "failed", reason: details.operation, details, lockFile };
    }
    const updatedAt = Date.parse(details.updatedAt || details.createdAt || "");
    const staleByTime = Number.isFinite(updatedAt) && Date.now() - updatedAt > (options.staleMs || DEFAULT_STALE_MS);
    const pid = Number(details.pid);
    if (Number.isFinite(pid) && pid > 0) {
      const processInfo = options.processInfoProvider ? options.processInfoProvider(pid) : getProcessInfo(pid);
      if (processInfo) {
        if (details.processStartedAt && processInfo.CreationDate && details.processStartedAt !== processInfo.CreationDate) {
          if (hasDatabaseChildProcess(config, details, options)) {
            return { status: "active", reason: "database-subprocess-active", details, lockFile };
          }
          return { status: "stale", reason: "pid-reused", details, lockFile };
        }
        return { status: "active", reason: "pid-alive", details, lockFile };
      }
    } else {
      return { status: "unknown", reason: "missing-pid", details, lockFile };
    }
    if (hasDatabaseChildProcess(config, details, options)) {
      return { status: "active", reason: "database-subprocess-active", details, lockFile };
    }
    const identity = await classifyServiceProcess(config.service, {
      root: config.root,
      port: config.port,
      processInfoProvider: options.serviceProcessInfoProvider,
      listeningPidProvider: options.listeningPidProvider,
    });
    if (!staleByTime) return { status: "unknown", reason: "pid-missing-lock-not-expired", details, lockFile };
    if (!["stopped", "stale"].includes(identity.status)) {
      return { status: "unknown", reason: `service-${identity.status}`, details, lockFile };
    }
    return { status: "stale", reason: "pid-missing-service-inactive", details, lockFile };
  } catch {
    return { status: "unknown", reason: "corrupt-lock", details: null, lockFile };
  }
}

function lockPath(config) {
  return join(config.runtimeDir, `operation-${config.service}.lock`);
}

function hasDatabaseChildProcess(config, details, options = {}) {
  if (options.databaseChildProcessProvider) return Boolean(options.databaseChildProcessProvider(details, config));
  if (process.platform !== "win32") return false;
  const result = spawnSync("powershell.exe", [
    "-NoProfile",
    "-Command",
    "Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(pg_restore|pg_dump)(\\.exe)?$' -or $_.CommandLine -match 'pg_restore|pg_dump' } | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress",
  ], {
    encoding: "utf8",
    shell: false,
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0 || !result.stdout.trim()) return false;
  try {
    const processes = JSON.parse(result.stdout);
    const rows = Array.isArray(processes) ? processes : [processes];
    return rows.some((processInfo) => databaseProcessMatchesLock(processInfo, config, details));
  } catch {
    return false;
  }
}

function databaseProcessMatchesLock(processInfo, config, details) {
  const commandLine = String(processInfo?.CommandLine || "");
  const parentPid = Number(processInfo?.ParentProcessId);
  const lockPid = Number(details?.pid);
  if (Number.isFinite(parentPid) && Number.isFinite(lockPid) && parentPid === lockPid) return true;
  return commandLine.includes(config.root)
    || commandLine.includes(config.service)
    || (details?.deploymentId && commandLine.includes(details.deploymentId))
    || (details?.backupDir && commandLine.includes(details.backupDir));
}
