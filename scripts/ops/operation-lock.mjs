import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_STALE_MS = 30 * 60 * 1000;

export function acquireServiceOperationLock(config, operation, details = {}, options = {}) {
  mkdirSync(config.runtimeDir, { recursive: true });
  const lockFile = lockPath(config, operation);
  removeStaleLock(lockFile, options.staleMs || DEFAULT_STALE_MS);
  if (options.existingLock) return { ...options.existingLock, shared: true, ownerLock: options.existingLock };
  const fd = openSync(lockFile, "wx");
  const payload = {
    lockVersion: 1,
    serviceName: config.service,
    operation,
    pid: process.pid,
    createdAt: new Date().toISOString(),
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
    error: error instanceof Error ? error.message : String(error),
  };
  writeFileSync(lock.lockFile, JSON.stringify(payload, null, 2));
  ownerLock.failed = true;
  ownerLock.payload = payload;
  return { ...lock, failed: true, payload };
}

export function getActiveServiceOperation(config, operations = ["deploy", "rollback"]) {
  const lockFile = lockPath(config, operations[0] || "deploy");
  removeStaleLock(lockFile, DEFAULT_STALE_MS);
  if (!existsSync(lockFile)) return null;
  try {
    return { operation: JSON.parse(readFileSync(lockFile, "utf8")).operation || operations[0] || "deploy", lockFile, details: JSON.parse(readFileSync(lockFile, "utf8")) };
  } catch {
    return { operation: operations[0] || "deploy", lockFile, details: null };
  }
}

function lockPath(config) {
  return join(config.runtimeDir, `operation-${config.service}.lock`);
}

function removeStaleLock(lockFile, staleMs) {
  if (existsSync(lockFile) && Date.now() - statSync(lockFile).mtimeMs > staleMs) {
    rmSync(lockFile, { force: true });
  }
}
