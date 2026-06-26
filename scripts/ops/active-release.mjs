import { randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, parse, relative, resolve } from "node:path";
import { safeGit } from "./git-utils.mjs";

export const activeReleaseVersion = 2;
export const activeReleaseStatus = "active";

const activeReleaseTempAttempts = 5;

export function getActiveReleaseFile(config) {
  return config.activeReleaseFile || join(config.runtimeDir, "active-release.json");
}

export function readActiveRelease(config) {
  const file = getActiveReleaseFile(config);
  if (!existsSync(file)) return null;
  try {
    return normalizeActiveRelease(config, JSON.parse(readFileSync(file, "utf8")));
  } catch (error) {
    throw new Error(`Active release metadata is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function writeActiveRelease(config, details = {}, options = {}) {
  const targetFile = getActiveReleaseFile(config);
  const payload = buildActiveReleasePayload(config, details);
  const previous = existsSync(targetFile) ? readActiveRelease(config, { optional: false }) : null;
  mkdirSync(config.runtimeDir, { recursive: true });
  writeJsonAtomically(targetFile, payload, options.writerOptions);
  try {
    const stored = (options.readBack || defaultReadBack)(config);
    assertStoredActiveReleaseMatches(payload, stored);
    return stored;
  } catch (error) {
    recoverFailedActiveReleaseUpdate(config, previous, options);
    throw error;
  }
}

export function restoreActiveRelease(config, previousActiveRelease) {
  if (!previousActiveRelease) {
    clearActiveRelease(config);
    return null;
  }
  return writeActiveRelease(config, previousActiveRelease);
}

export function clearActiveRelease(config) {
  rmSync(getActiveReleaseFile(config), { force: true });
}

export function resolveServiceRuntime(config, options = {}) {
  const activeRelease = readActiveRelease(config, { optional: options.optional !== false });
  if (activeRelease) return { activeRelease, runtimeRoot: activeRelease.releaseRoot };
  return { activeRelease: null, runtimeRoot: config.root };
}

export function writeJsonAtomically(targetFile, payload, options = {}) {
  const mkdir = options.mkdirSync || mkdirSync;
  const write = options.writeFileSync || writeFileSync;
  const fsync = options.fsyncSync || fsyncSync;
  const close = options.closeSync || closeSync;
  const rename = options.renameSync || renameSync;
  const unlink = options.unlinkSync || unlinkSync;
  const warn = options.warn || defaultAtomicWriteWarning;
  const json = `${JSON.stringify(payload, null, 2)}\n`;
  const dir = resolve(dirname(targetFile));

  mkdir(dir, { recursive: true });

  let fd = null;
  let tempFile = null;
  let tempCreated = false;
  try {
    ({ fd, tempFile } = createExclusiveTempFile(targetFile, options));
    tempCreated = true;
    write(fd, json, { encoding: "utf8" });
    fsync(fd);
    close(fd);
    fd = null;
    rename(tempFile, targetFile);
    return { targetFile, tempFile, json };
  } catch (error) {
    if (fd != null) {
      try {
        close(fd);
      } catch (closeError) {
        warn(`[active-release] failed to close temporary metadata file handle for ${basename(targetFile)}: ${formatError(closeError)}`);
      }
    }
    if (tempCreated && tempFile) {
      try {
        unlink(tempFile);
      } catch (cleanupError) {
        warn(`[active-release] failed to remove temporary metadata file ${tempFile}: ${formatError(cleanupError)}`);
      }
    }
    throw error;
  }
}

export function assertReleaseRootSafe(config, releaseRoot) {
  const resolvedReleaseRoot = resolve(String(releaseRoot || ""));
  const releasesRoot = resolve(join(config.runtimeDir, "releases"));
  const relativePath = relative(releasesRoot, resolvedReleaseRoot);
  if (!relativePath || relativePath === "." || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`Release root escaped the service release directory: ${resolvedReleaseRoot}`);
  }
  if (!sameVolume(config.root, resolvedReleaseRoot)) {
    throw new Error(`Release root must stay on the same volume as the service root: ${resolvedReleaseRoot}`);
  }
  if (samePath(resolvedReleaseRoot, config.dataDir) || samePath(resolvedReleaseRoot, config.uploadsDir)) {
    throw new Error(`Release root overlaps runtime storage: ${resolvedReleaseRoot}`);
  }
  if (isPathInside(resolvedReleaseRoot, config.dataDir) || isPathInside(resolvedReleaseRoot, config.uploadsDir)) {
    throw new Error(`Release root must not contain data/uploads: ${resolvedReleaseRoot}`);
  }
  if (isPathInside(config.dataDir, resolvedReleaseRoot) || isPathInside(config.uploadsDir, resolvedReleaseRoot)) {
    throw new Error(`Release root must not be nested under data/uploads: ${resolvedReleaseRoot}`);
  }
  if (!existsSync(join(resolvedReleaseRoot, "package.json"))) {
    throw new Error(`Release root is missing package.json: ${resolvedReleaseRoot}`);
  }
}

function buildActiveReleasePayload(config, details) {
  const releaseRoot = resolve(String(details.releaseRoot || ""));
  const payload = {
    version: activeReleaseVersion,
    serviceName: String(details.serviceName || details.service || config.service),
    service: config.service,
    serviceRoot: resolve(String(details.serviceRoot || config.root)),
    releaseId: String(details.releaseId || basename(releaseRoot)),
    releaseRoot,
    runtimeCommit: String(details.runtimeCommit || safeGit(releaseRoot, ["rev-parse", "HEAD"], "unknown")),
    deploymentId: details.deploymentId == null ? null : String(details.deploymentId),
    status: String(details.status || activeReleaseStatus),
    activatedAt: details.activatedAt ? String(details.activatedAt) : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  validateActiveReleasePayload(config, payload);
  return payload;
}

function normalizeActiveRelease(config, raw) {
  if (!raw || typeof raw !== "object") {
    throw new Error("Active release metadata must be an object.");
  }
  const version = Number(raw.version || 1);
  const releaseRoot = resolve(String(raw.releaseRoot || ""));
  const legacyCompatible = version < activeReleaseVersion;
  const payload = {
    version,
    serviceName: String(raw.serviceName || raw.service || ""),
    service: config.service,
    serviceRoot: resolve(String(raw.serviceRoot || raw.root || "")),
    releaseId: String(raw.releaseId || (legacyCompatible ? basename(releaseRoot) : "")),
    releaseRoot,
    runtimeCommit: String(raw.runtimeCommit || (legacyCompatible ? safeGit(releaseRoot, ["rev-parse", "HEAD"], "unknown") : "")),
    deploymentId: raw.deploymentId == null ? null : String(raw.deploymentId),
    status: String(raw.status || (legacyCompatible ? activeReleaseStatus : "")),
    activatedAt: raw.activatedAt || raw.createdAt || null,
    updatedAt: raw.updatedAt || null,
  };
  validateActiveReleasePayload(config, payload);
  return payload;
}

function validateActiveReleasePayload(config, payload) {
  const missing = [];
  for (const key of ["serviceName", "releaseId", "releaseRoot", "runtimeCommit", "status"]) {
    if (!String(payload[key] || "").trim()) missing.push(key);
  }
  if (missing.length) {
    throw new Error(`Active release metadata is missing required field(s): ${missing.join(", ")}`);
  }
  if (payload.serviceName !== config.service || payload.service !== config.service) {
    throw new Error("Active release metadata belongs to a different service.");
  }
  const serviceRoot = resolve(String(payload.serviceRoot || ""));
  if (!samePath(serviceRoot, config.root)) {
    throw new Error("Active release metadata points at a different service root.");
  }
  const releaseRoot = resolve(String(payload.releaseRoot || ""));
  assertReleaseRootSafe(config, releaseRoot);
  if (payload.releaseId !== basename(releaseRoot)) {
    throw new Error("Active release metadata releaseId does not match the release root.");
  }
  if (payload.runtimeCommit === "unknown") {
    throw new Error("Active release metadata runtimeCommit is unknown.");
  }
  if (payload.status !== activeReleaseStatus) {
    throw new Error(`Active release metadata status must be ${activeReleaseStatus}.`);
  }
}

function assertStoredActiveReleaseMatches(expected, actual) {
  if (!actual) throw new Error("Active release metadata reread returned no value.");
  for (const key of ["serviceName", "releaseId", "releaseRoot", "runtimeCommit", "status"]) {
    if (String(actual[key] || "") !== String(expected[key] || "")) {
      throw new Error(`Active release metadata reread mismatch for ${key}.`);
    }
  }
}

function defaultReadBack(config) {
  return readActiveRelease(config, { optional: false });
}

function recoverFailedActiveReleaseUpdate(config, previous, options = {}) {
  const targetFile = getActiveReleaseFile(config);
  const warn = options.writerOptions?.warn || defaultAtomicWriteWarning;
  try {
    if (previous) {
      writeJsonAtomically(targetFile, previous, options.rollbackWriterOptions || options.writerOptions);
      return;
    }
    rmSync(targetFile, { force: true });
  } catch (error) {
    warn(`[active-release] failed to recover ${basename(targetFile)} after metadata verification error: ${formatError(error)}`);
  }
}

function createExclusiveTempFile(targetFile, options = {}) {
  const open = options.openSync || openSync;
  const tempDir = resolve(dirname(targetFile));
  const targetBase = basename(targetFile);
  const now = options.now || (() => Date.now());
  const pid = options.pid ?? process.pid;
  const uuid = options.randomUUID || randomUUID;

  for (let attempt = 0; attempt < activeReleaseTempAttempts; attempt += 1) {
    const tempFile = join(tempDir, `${targetBase}.${pid}.${now()}.${uuid()}.tmp`);
    try {
      return { fd: open(tempFile, "wx", 0o600), tempFile };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
  throw new Error(`Unable to reserve a unique temporary metadata file for ${targetBase}.`);
}

function defaultAtomicWriteWarning(message) {
  console.warn(message);
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

function sameVolume(left, right) {
  if (process.platform === "win32") {
    return parse(resolve(left)).root.toLowerCase() === parse(resolve(right)).root.toLowerCase();
  }
  return true;
}

function samePath(left, right) {
  return resolve(left).toLowerCase() === resolve(right).toLowerCase();
}

function isPathInside(parent, child) {
  const relativePath = relative(resolve(parent), resolve(child));
  return Boolean(relativePath) && !relativePath.startsWith("..") && !isAbsolute(relativePath);
}
