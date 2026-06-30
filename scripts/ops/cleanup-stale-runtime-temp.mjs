#!/usr/bin/env node
import { lstat, opendir, unlink } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";

const root = process.cwd();
const defaultOlderThanHours = 24;

class CleanupError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

main().catch((error) => {
  const message = error instanceof CleanupError ? error.message : "Cleanup failed.";
  const code = error instanceof CleanupError ? error.code : "cleanup_failed";
  console.error(JSON.stringify({
    ok: false,
    code,
    message,
    deleted: 0,
  }, null, 2));
  process.exit(1);
});

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const roots = runtimeRootsFromEnv(process.env);
  assertRuntimeRoots(roots);

  const cutoffMs = Date.now() - options.olderThanHours * 60 * 60 * 1000;
  const summaries = [];
  let scannedFiles = 0;
  let candidateFiles = 0;
  let staleTmpFiles = 0;
  let deletedFiles = 0;
  let skippedSymlinks = 0;
  let skippedNonTmp = 0;
  let skippedProtected = 0;

  for (const rootInfo of roots) {
    await assertSafeRuntimeRoot(rootInfo);
    const result = await scanRoot(rootInfo, cutoffMs, options.apply);
    scannedFiles += result.scannedFiles;
    candidateFiles += result.candidateFiles;
    staleTmpFiles += result.staleTmpFiles;
    deletedFiles += result.deletedFiles;
    skippedSymlinks += result.skippedSymlinks;
    skippedNonTmp += result.skippedNonTmp;
    skippedProtected += result.skippedProtected;
    summaries.push({
      root: rootInfo.label,
      scannedFiles: result.scannedFiles,
      staleTmpFiles: result.staleTmpFiles,
      deletedFiles: result.deletedFiles,
      skippedSymlinks: result.skippedSymlinks,
      skippedProtected: result.skippedProtected,
      samples: result.samples,
    });
  }

  console.log(JSON.stringify({
    ok: true,
    mode: options.apply ? "apply" : "dry-run",
    olderThanHours: options.olderThanHours,
    scannedFiles,
    candidateFiles,
    staleTmpFiles,
    deletedFiles,
    skippedSymlinks,
    skippedNonTmp,
    skippedProtected,
    roots: summaries,
  }, null, 2));
}

function parseArgs(args) {
  let apply = false;
  let confirm = false;
  let dryRun = false;
  let olderThanHours = defaultOlderThanHours;

  for (const arg of args) {
    if (arg === "--apply") {
      apply = true;
    } else if (arg === "--confirm-runtime-cleanup") {
      confirm = true;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg.startsWith("--older-than-hours=")) {
      const value = Number(arg.slice("--older-than-hours=".length));
      if (!Number.isFinite(value) || value <= 0) {
        throw new CleanupError("invalid_older_than_hours", "older-than-hours must be a positive number.");
      }
      olderThanHours = value;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new CleanupError("invalid_argument", `Unsupported argument: ${redactArg(arg)}`);
    }
  }

  if (apply && dryRun) {
    throw new CleanupError("invalid_mode", "Choose either dry-run or apply, not both.");
  }
  if (apply && !confirm) {
    throw new CleanupError("apply_requires_confirmation", "Apply mode requires --confirm-runtime-cleanup.");
  }

  return { apply, olderThanHours };
}

function runtimeRootsFromEnv(env) {
  const dataDir = env.DATA_DIR?.trim();
  const uploadsDir = env.UPLOADS_DIR?.trim();
  if (!dataDir || !uploadsDir) {
    throw new CleanupError("explicit_runtime_roots_required", "DATA_DIR and UPLOADS_DIR must both be set explicitly.");
  }
  return [
    { label: "DATA_DIR", path: resolve(root, dataDir) },
    { label: "UPLOADS_DIR", path: resolve(root, uploadsDir) },
  ];
}

function assertRuntimeRoots(roots) {
  const defaultData = normalizePath(resolve(root, "data"));
  const defaultUploads = normalizePath(resolve(root, "uploads"));
  const seen = new Set();
  for (const rootInfo of roots) {
    const normalized = normalizePath(rootInfo.path);
    if (
      isSameOrChildPath(normalized, defaultData)
      || isSameOrChildPath(normalized, defaultUploads)
      || isProductionLikeRootName(rootInfo)
    ) {
      throw new CleanupError("default_runtime_root_refused", `${rootInfo.label} points at a default runtime root and was refused.`);
    }
    if (seen.has(normalized)) {
      throw new CleanupError("duplicate_runtime_root_refused", "DATA_DIR and UPLOADS_DIR must not point at the same directory.");
    }
    seen.add(normalized);
  }
}

async function assertSafeRuntimeRoot(rootInfo) {
  let stats;
  try {
    stats = await lstat(rootInfo.path);
  } catch {
    throw new CleanupError("runtime_root_unavailable", `${rootInfo.label} is not an available directory.`);
  }
  if (stats.isSymbolicLink()) {
    throw new CleanupError("runtime_root_symlink_refused", `${rootInfo.label} must not be a symlink.`);
  }
  if (!stats.isDirectory()) {
    throw new CleanupError("runtime_root_not_directory", `${rootInfo.label} must be a directory.`);
  }
}

async function scanRoot(rootInfo, cutoffMs, apply) {
  const result = {
    scannedFiles: 0,
    candidateFiles: 0,
    staleTmpFiles: 0,
    deletedFiles: 0,
    skippedSymlinks: 0,
    skippedNonTmp: 0,
    skippedProtected: 0,
    samples: [],
  };
  await walk(rootInfo.path, rootInfo, cutoffMs, apply, result);
  return result;
}

async function walk(directory, rootInfo, cutoffMs, apply, result) {
  const dir = await opendir(directory);
  for await (const entry of dir) {
    const fullPath = join(directory, entry.name);
    const stats = await lstat(fullPath);
    if (stats.isSymbolicLink()) {
      result.skippedSymlinks += 1;
      continue;
    }
    if (stats.isDirectory()) {
      await walk(fullPath, rootInfo, cutoffMs, apply, result);
      continue;
    }
    if (!stats.isFile()) continue;

    result.scannedFiles += 1;
    if (!entry.name.endsWith(".tmp")) {
      result.skippedNonTmp += 1;
      continue;
    }
    if (isProtectedRuntimeFileName(entry.name)) {
      result.skippedProtected += 1;
      continue;
    }

    result.candidateFiles += 1;
    if (stats.mtimeMs > cutoffMs) continue;

    result.staleTmpFiles += 1;
    addSample(result, rootInfo, fullPath);
    if (apply) {
      await unlink(fullPath);
      result.deletedFiles += 1;
    }
  }
}

function addSample(result, rootInfo, fullPath) {
  if (result.samples.length >= 20) return;
  result.samples.push(`${rootInfo.label}:${sanitizeRelativePath(rootInfo.path, fullPath)}`);
}

function sanitizeRelativePath(rootPath, fullPath) {
  const rel = relative(rootPath, fullPath).split(sep).join("/");
  if (!rel || rel.startsWith("../") || rel === "..") return basename(fullPath);
  return rel.replace(/[^\w./-]/g, "_");
}

function normalizePath(path) {
  const resolved = resolve(path).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isSameOrChildPath(candidate, parent) {
  return candidate === parent || candidate.startsWith(`${parent}${sep}`);
}

function isProductionLikeRootName(rootInfo) {
  const name = basename(rootInfo.path).toLowerCase();
  return (rootInfo.label === "DATA_DIR" && name === "data")
    || (rootInfo.label === "UPLOADS_DIR" && name === "uploads");
}

function isProtectedRuntimeFileName(name) {
  const lower = name.toLowerCase();
  if (!lower.endsWith(".tmp")) return true;
  const withoutTmp = lower.slice(0, -4);
  return /\.(?:png|jpe?g|webp|gif|mp4|mov|webm|json|db|sqlite|sqlite3|log|bak|backup|zip|tar|gz|sql|dump)$/.test(withoutTmp);
}

function redactArg(arg) {
  return String(arg)
    .replace(/(token|password|secret|key|signature)=([^&\s]+)/gi, "$1=[REDACTED]")
    .slice(0, 80);
}

function printHelp() {
  console.log([
    "Usage:",
    "  node scripts/ops/cleanup-stale-runtime-temp.mjs --dry-run",
    "  node scripts/ops/cleanup-stale-runtime-temp.mjs --apply --confirm-runtime-cleanup --older-than-hours=24",
    "",
    "Requires explicit DATA_DIR and UPLOADS_DIR environment variables.",
    "Deletes only stale regular *.tmp files in apply mode.",
  ].join("\n"));
}
