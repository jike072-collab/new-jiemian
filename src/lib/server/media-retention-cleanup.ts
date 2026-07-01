import { mkdir, lstat, readdir, realpath, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";

import { mediaCompletedAt, mediaExpiresAt, resolveMediaRetentionHours } from "../media-retention";
import { ensureRuntimeDirs, resolveUploadPath, safeStoredName, uploadsRoot } from "./paths";
import {
  expireLibraryItemMedia,
  markLibraryItemExpirationPending,
  markLibraryItemExpirationStage,
  readJobs,
  readLibrary,
} from "./library";
import type { JobRecord, LibraryItem } from "./types";

type CleanupMode = "dry-run" | "apply";

export type ExpiredMediaCleanupOptions = {
  mode?: CleanupMode;
  now?: Date;
  retentionHours?: number;
};

type CleanupItem = {
  id: string;
  relativePath: string;
  size: number;
};

type SkippedItem = {
  id: string;
  reason: string;
  relativePath?: string;
};

export type ExpiredMediaCleanupResult = {
  ok: boolean;
  mode: CleanupMode;
  retentionHours: number;
  expiredBefore: string;
  candidates: number;
  deletedFiles: number;
  expiredItems: number;
  totalBytes: number;
  items: CleanupItem[];
  skipped: number;
  skippedItems: SkippedItem[];
  errors: Array<{ id: string; code: string }>;
};

type LocalMediaTarget =
  | { ok: true; path: string; relativePath: string; exists: boolean; size: number }
  | { ok: false; reason: string; relativePath?: string };

type ExpireOutcome = {
  deletedFiles: number;
  expiredItems: number;
};

const processingStatuses = new Set(["queued", "generating", "uploading", "running", "processing"]);
const quarantineDirName = ".retention-quarantine";

export async function cleanupExpiredMedia(options: ExpiredMediaCleanupOptions = {}): Promise<ExpiredMediaCleanupResult> {
  const mode = options.mode || "dry-run";
  const retentionHours = options.retentionHours ?? resolveMediaRetentionHours();
  const now = options.now || new Date();
  const expiredBefore = new Date(now.getTime() - retentionHours * 60 * 60 * 1000).toISOString();
  const result: ExpiredMediaCleanupResult = {
    ok: true,
    mode,
    retentionHours,
    expiredBefore,
    candidates: 0,
    deletedFiles: 0,
    expiredItems: 0,
    totalBytes: 0,
    items: [],
    skipped: 0,
    skippedItems: [],
    errors: [],
  };

  await ensureRuntimeDirs();
  const [items, jobs, uploadsRootReal] = await Promise.all([
    readLibrary(),
    readJobs(),
    realpath(uploadsRoot),
  ]);
  const processingItemIds = new Set(
    jobs
      .filter((job) => isProcessingJob(job))
      .map((job) => job.libraryItemId),
  );
  const recoveredIds = new Set<string>();

  if (mode === "apply") {
    await scanRecordBackedQuarantineOrphans(items, uploadsRootReal);
    for (const item of items) {
      if (!hasRecoverableExpiration(item)) continue;
      recoveredIds.add(item.id);
      result.candidates += 1;
      addRecoverySummary(result, item);
      try {
        const outcome = await recoverMediaExpiration(item, uploadsRootReal, now.toISOString());
        result.deletedFiles += outcome.deletedFiles;
        result.expiredItems += outcome.expiredItems;
      } catch {
        result.ok = false;
        result.errors.push({ id: item.id, code: "recover_media_expiration_failed" });
        return result;
      }
    }
  }

  for (const item of items) {
    if (recoveredIds.has(item.id)) continue;
    if (!isExpiredLocalMediaCandidate(item, processingItemIds, now, retentionHours)) continue;
    result.candidates += 1;
    const target = await resolveLocalMediaTarget(item, uploadsRootReal);
    if (!target.ok) {
      addSkipped(result, item.id, target.reason, target.relativePath);
      continue;
    }

    const summary = { id: item.id, relativePath: target.relativePath, size: target.size };
    result.items.push(summary);
    result.totalBytes += target.size;

    if (mode === "dry-run") continue;

    try {
      const outcome = await expireMediaCandidate(item, target, uploadsRootReal, now.toISOString());
      result.deletedFiles += outcome.deletedFiles;
      result.expiredItems += outcome.expiredItems;
    } catch {
      result.ok = false;
      result.errors.push({ id: item.id, code: "expire_media_failed" });
      break;
    }
  }

  return result;
}

async function expireMediaCandidate(
  item: LibraryItem,
  target: Extract<LocalMediaTarget, { ok: true }>,
  uploadsRootReal: string,
  expiredAt: string,
): Promise<ExpireOutcome> {
  const storedName = item.output?.storedName || item.expirationPendingStoredName || basename(target.path);
  const pendingItem = item.expirationPending
    ? item
    : await markLibraryItemExpirationPending(item, expiredAt, storedName);
  await maybeFail("AOHUANG_TEST_FAIL_MEDIA_EXPIRATION_AFTER_PENDING", item.id);
  return advanceExpirationState(pendingItem, target, uploadsRootReal, expiredAt);
}

async function recoverMediaExpiration(
  item: LibraryItem,
  uploadsRootReal: string,
  expiredAt: string,
): Promise<ExpireOutcome> {
  if (item.expired && item.expirationQuarantineName) {
    const quarantine = await resolveQuarantineTarget(item, uploadsRootReal);
    if (quarantine.ok && await fileExists(quarantine.path)) {
      await unlinkQuarantineFile(quarantine.path, item.id);
      await expireLibraryItemMedia(item, item.expiredAt || expiredAt);
      return { deletedFiles: 1, expiredItems: 0 };
    }
    await expireLibraryItemMedia(item, item.expiredAt || expiredAt);
    return { deletedFiles: 0, expiredItems: 0 };
  }

  const target = await resolveLocalMediaTarget(item, uploadsRootReal);
  if (!target.ok) {
    if (item.expirationStage === "fileDeleted") {
      await expireLibraryItemMedia(item, expiredAt);
      return { deletedFiles: 0, expiredItems: 1 };
    }
    throw new Error("recoverable media target is invalid");
  }
  return advanceExpirationState(item, target, uploadsRootReal, expiredAt);
}

async function advanceExpirationState(
  item: LibraryItem,
  target: Extract<LocalMediaTarget, { ok: true }>,
  uploadsRootReal: string,
  expiredAt: string,
): Promise<ExpireOutcome> {
  let current = item;
  let deletedFiles = 0;
  let stage = current.expirationStage || (current.expirationPending ? "pending" : undefined);

  if (!stage) {
    current = await markLibraryItemExpirationPending(
      current,
      expiredAt,
      current.output?.storedName || current.expirationPendingStoredName || basename(target.path),
    );
    await maybeFail("AOHUANG_TEST_FAIL_MEDIA_EXPIRATION_AFTER_PENDING", current.id);
    stage = "pending";
  }

  if (stage === "pending") {
    const quarantine = await ensureQuarantineTarget(current, target, uploadsRootReal, expiredAt);
    const originalExists = await fileExists(target.path);
    const quarantineExists = await fileExists(quarantine.path);
    if (originalExists) {
      if (quarantineExists) {
        await unlinkQuarantineFile(quarantine.path, current.id);
      }
      await rename(target.path, quarantine.path);
      await maybeFail("AOHUANG_TEST_FAIL_MEDIA_EXPIRATION_AFTER_RENAME", current.id);
      current = await markLibraryItemExpirationStage(current, "quarantined", expiredAt);
    } else if (quarantineExists) {
      current = await markLibraryItemExpirationStage(current, "quarantined", expiredAt);
    } else {
      current = await markLibraryItemExpirationStage(current, "fileDeleted", expiredAt);
    }
    stage = current.expirationStage || "quarantined";
  }

  if (stage === "quarantined") {
    const quarantine = await resolveQuarantineTarget(current, uploadsRootReal);
    if (quarantine.ok && await fileExists(quarantine.path)) {
      await unlinkQuarantineFile(quarantine.path, current.id);
      deletedFiles += 1;
    }
    current = await markLibraryItemExpirationStage(current, "fileDeleted", expiredAt);
    await maybeFail("AOHUANG_TEST_FAIL_MEDIA_EXPIRATION_AFTER_FILE_DELETED", current.id);
    stage = "fileDeleted";
  }

  if (stage === "fileDeleted") {
    await expireLibraryItemMedia(current, expiredAt);
    return { deletedFiles, expiredItems: current.expired ? 0 : 1 };
  }

  throw new Error("unknown media expiration stage");
}

async function ensureQuarantineTarget(
  item: LibraryItem,
  target: Extract<LocalMediaTarget, { ok: true }>,
  uploadsRootReal: string,
  expiredAt: string,
) {
  if (!item.expirationQuarantineName) {
    const refreshed = await markLibraryItemExpirationPending(
      item,
      item.expirationPendingAt || expiredAt,
      item.expirationPendingStoredName || item.output?.storedName || basename(target.path),
    );
    return ensureQuarantineTarget(refreshed, target, uploadsRootReal, expiredAt);
  }
  const quarantine = await resolveQuarantineTarget(item, uploadsRootReal);
  if (!quarantine.ok) throw new Error(quarantine.reason);
  return quarantine;
}

async function resolveQuarantineTarget(item: LibraryItem, uploadsRootReal: string): Promise<LocalMediaTarget> {
  const quarantineName = safeStoredName(item.expirationQuarantineName || "");
  const relativePath = quarantineName ? `UPLOADS_DIR:${quarantineDirName}/${sanitizeRelativeName(quarantineName)}` : undefined;
  if (!quarantineName || quarantineName !== item.expirationQuarantineName) {
    return { ok: false, reason: "invalid_quarantine_name", relativePath };
  }

  const quarantineRoot = await ensureQuarantineRoot(uploadsRootReal);
  const path = resolve(quarantineRoot, quarantineName);
  if (!isSameOrChildPath(path, quarantineRoot) || dirname(path) !== quarantineRoot) {
    return { ok: false, reason: "quarantine_path_outside_root", relativePath };
  }
  const exists = await fileExists(path);
  const size = exists ? await stat(path).then((value) => value.size).catch(() => 0) : 0;
  return {
    ok: true,
    path,
    relativePath: relativePath || `UPLOADS_DIR:${quarantineDirName}/${basename(path)}`,
    exists,
    size,
  };
}

async function ensureQuarantineRoot(uploadsRootReal: string) {
  const quarantineRoot = resolve(uploadsRoot, quarantineDirName);
  await mkdir(quarantineRoot, { recursive: true });
  const quarantineRootReal = await realpath(quarantineRoot);
  if (!isSameOrChildPath(quarantineRootReal, uploadsRootReal)) {
    throw new Error("retention quarantine root escaped uploads root");
  }
  return quarantineRoot;
}

async function scanRecordBackedQuarantineOrphans(items: LibraryItem[], uploadsRootReal: string) {
  const proofNames = new Set(
    items
      .map((item) => item.expirationQuarantineName)
      .filter((name): name is string => Boolean(name && safeStoredName(name) === name)),
  );
  if (proofNames.size === 0) return [];
  const quarantineRoot = await ensureQuarantineRoot(uploadsRootReal);
  const entries = await readdir(quarantineRoot, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile() && proofNames.has(entry.name))
    .map((entry) => resolve(quarantineRoot, entry.name))
    .filter((path) => isSameOrChildPath(path, quarantineRoot) && dirname(path) === quarantineRoot);
}

async function unlinkQuarantineFile(path: string, itemId: string) {
  const simulatedCode = simulatedUnlinkErrorCode(itemId);
  if (simulatedCode) {
    const error = new Error(`Simulated quarantine unlink failure: ${simulatedCode}`) as NodeJS.ErrnoException;
    error.code = simulatedCode;
    throw error;
  }
  await unlink(path);
}

function simulatedUnlinkErrorCode(itemId: string) {
  if (!testFailureInjectionAllowed()) return null;
  const raw = process.env.AOHUANG_TEST_FAIL_MEDIA_EXPIRATION_UNLINK;
  if (!raw) return null;
  const [target, code] = raw.includes(":") ? raw.split(":", 2) : ["*", raw];
  if (target !== "*" && target !== "__all__" && target !== itemId) return null;
  return code === "EACCES" || code === "EBUSY" ? code : "EACCES";
}

async function maybeFail(envName: string, itemId: string) {
  if (!testFailureInjectionAllowed()) return;
  const target = process.env[envName];
  if (!target) return;
  if (target === "*" || target === "__all__" || target === itemId) {
    throw new Error(`Simulated media expiration failure: ${envName}`);
  }
}

function testFailureInjectionAllowed() {
  return process.env.NODE_ENV === "test"
    || (
      process.env.PORT === "3107"
      && process.env.RUNTIME_STORAGE_ISOLATION === "strict"
      && process.env.AOHUANG_ALLOW_RUNTIME_DIR_OVERRIDE === "1"
    );
}

async function fileExists(path: string) {
  try {
    const value = await lstat(path);
    return value.isFile();
  } catch {
    return false;
  }
}

function hasRecoverableExpiration(item: LibraryItem) {
  return Boolean(item.expirationPending || item.expirationStage || item.expirationQuarantineName);
}

function isProcessingJob(job: JobRecord) {
  return processingStatuses.has(String(job.status).toLowerCase());
}

function isExpiredLocalMediaCandidate(
  item: LibraryItem,
  processingItemIds: Set<string>,
  now: Date,
  retentionHours: number,
) {
  if (item.expired && !item.expirationQuarantineName) return false;
  if (item.status !== "done") return false;
  if (processingItemIds.has(item.id)) return false;
  if (!item.output?.storedName && !item.expirationPendingStoredName) return false;
  const completedAt = new Date(mediaCompletedAt(item));
  if (Number.isNaN(completedAt.getTime())) return false;
  const expiresAt = mediaExpiresAt(item, retentionHours);
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() <= now.getTime();
}

async function resolveLocalMediaTarget(item: LibraryItem, uploadsRootReal: string): Promise<LocalMediaTarget> {
  const storedName = item.output?.storedName || item.expirationPendingStoredName || "";
  const safeName = safeStoredName(storedName);
  const relativePath = safeName ? `UPLOADS_DIR:${sanitizeRelativePath(safeName)}` : undefined;
  if (!safeName || safeName !== storedName) return { ok: false, reason: "invalid_stored_name", relativePath };

  const path = resolveUploadPath(safeName);
  if (!isSameOrChildPath(path, uploadsRoot)) {
    return { ok: false, reason: "path_outside_uploads_root", relativePath };
  }

  let fileStat;
  try {
    fileStat = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      return { ok: false, reason: "file_stat_failed", relativePath };
    }
    return {
      ok: true,
      path,
      relativePath: relativePath || `UPLOADS_DIR:${basename(path)}`,
      exists: false,
      size: safeSize(item.output?.size),
    };
  }

  if (fileStat.isSymbolicLink()) {
    return { ok: false, reason: "symlink_refused", relativePath };
  }
  if (!fileStat.isFile()) {
    return { ok: false, reason: "not_regular_file", relativePath };
  }

  let fileRealPath;
  try {
    fileRealPath = await realpath(path);
  } catch {
    return { ok: false, reason: "realpath_failed", relativePath };
  }
  if (!isSameOrChildPath(fileRealPath, uploadsRootReal)) {
    return { ok: false, reason: "realpath_outside_uploads_root", relativePath };
  }

  const size = await stat(path).then((value) => value.size).catch(() => safeSize(item.output?.size));
  return {
    ok: true,
    path,
    relativePath: relativePath || `UPLOADS_DIR:${basename(path)}`,
    exists: true,
    size,
  };
}

function addRecoverySummary(result: ExpiredMediaCleanupResult, item: LibraryItem) {
  const storedName = item.expirationPendingStoredName || item.output?.storedName || item.expirationQuarantineName;
  const relativePath = item.expirationQuarantineName
    ? `UPLOADS_DIR:${quarantineDirName}/${sanitizeRelativeName(item.expirationQuarantineName)}`
    : storedName
      ? `UPLOADS_DIR:${sanitizeRelativeName(storedName)}`
      : "UPLOADS_DIR:pending-expiration";
  const summary = { id: item.id, relativePath, size: safeSize(item.output?.size) };
  result.items.push(summary);
  result.totalBytes += summary.size;
}

function addSkipped(result: ExpiredMediaCleanupResult, id: string, reason: string, relativePath?: string) {
  result.skipped += 1;
  result.skippedItems.push({ id, reason, ...(relativePath ? { relativePath } : {}) });
}

function safeSize(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function normalizePath(path: string) {
  const normalized = resolve(path).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isSameOrChildPath(candidate: string, parent: string) {
  const normalizedCandidate = normalizePath(candidate);
  const normalizedParent = normalizePath(parent);
  if (normalizedCandidate === normalizedParent) return true;
  return normalizedCandidate.startsWith(`${normalizedParent}${sep}`);
}

function sanitizeRelativePath(storedName: string) {
  const rel = relative(uploadsRoot, resolveUploadPath(storedName)).split(sep).join("/");
  const safeRel = !rel || rel.startsWith("../") || rel === ".." ? basename(storedName) : rel;
  return sanitizeRelativeName(safeRel);
}

function sanitizeRelativeName(value: string) {
  return value.replace(/[^\w./-]/g, "_");
}
