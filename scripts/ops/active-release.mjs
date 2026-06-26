import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, parse, relative, resolve } from "node:path";
import { safeGit } from "./git-utils.mjs";

export const activeReleaseVersion = 1;

export function getActiveReleaseFile(config) {
  return config.activeReleaseFile || join(config.runtimeDir, "active-release.json");
}

export function readActiveRelease(config, options = {}) {
  const file = getActiveReleaseFile(config);
  if (!existsSync(file)) return null;
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    if (options.optional === true) return null;
    throw new Error(`Active release metadata is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  return normalizeActiveRelease(config, raw);
}

export function writeActiveRelease(config, details = {}) {
  const releaseRoot = resolve(String(details.releaseRoot || ""));
  assertReleaseRootSafe(config, releaseRoot);
  const payload = {
    version: activeReleaseVersion,
    serviceName: config.service,
    service: config.service,
    serviceRoot: config.root,
    releaseRoot,
    runtimeCommit: details.runtimeCommit || safeGit(releaseRoot, ["rev-parse", "HEAD"], "unknown"),
    deploymentId: details.deploymentId || null,
    activatedAt: details.activatedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  mkdirSync(config.runtimeDir, { recursive: true });
  writeFileSync(getActiveReleaseFile(config), JSON.stringify(payload, null, 2));
  return payload;
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

function normalizeActiveRelease(config, raw) {
  if (!raw || typeof raw !== "object") {
    throw new Error("Active release metadata must be an object.");
  }
  if ((raw.serviceName || raw.service) !== config.service) {
    throw new Error("Active release metadata belongs to a different service.");
  }
  const serviceRoot = resolve(String(raw.serviceRoot || raw.root || ""));
  if (!samePath(serviceRoot, config.root)) {
    throw new Error("Active release metadata points at a different service root.");
  }
  const releaseRoot = resolve(String(raw.releaseRoot || ""));
  assertReleaseRootSafe(config, releaseRoot);
  return {
    version: Number(raw.version || activeReleaseVersion),
    serviceName: config.service,
    service: config.service,
    serviceRoot: config.root,
    releaseRoot,
    runtimeCommit: raw.runtimeCommit || safeGit(releaseRoot, ["rev-parse", "HEAD"], "unknown"),
    deploymentId: raw.deploymentId || null,
    activatedAt: raw.activatedAt || raw.createdAt || null,
    updatedAt: raw.updatedAt || null,
  };
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
