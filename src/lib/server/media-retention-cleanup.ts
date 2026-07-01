import { mkdir, lstat, readdir, realpath, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";

import { mediaCompletedAt, mediaExpiresAt, resolveMediaRetentionHours } from "../media-retention";
import { ensureRuntimeDirs, resolveUploadPath, safeStoredName, uploadsRoot } from "./paths";
import {
  clearLibraryItemExpirationPending,
  expireLibraryItemMedia,
  markLibraryItemExpirationPending,
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

  for (const item of items) {
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
      result.expiredItems += 1;
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
) {
  if (!target.exists) {
    const quarantined = await findQuarantinedMediaFile(item, target, uploadsRootReal);
    await expireLibraryItemMedia(item, expiredAt);
    if (quarantined) {
      await unlink(quarantined);
      return { deletedFiles: 1 };
    }
    return { deletedFiles: 0 };
  }

  const quarantinePath = await quarantineMediaFile(item, target, uploadsRootReal, expiredAt);
  let pendingItem: LibraryItem | null = null;
  try {
    pendingItem = await markLibraryItemExpirationPending(item, expiredAt, item.output?.storedName || basename(target.path));
  } catch (error) {
    await restoreQuarantinedFile(quarantinePath, target.path);
    throw error;
  }

  try {
    const expiredItem = await expireLibraryItemMedia(pendingItem, expiredAt);
    await unlink(quarantinePath);
    return { deletedFiles: 1, expiredItem };
  } catch (error) {
    const restored = await restoreQuarantinedFile(quarantinePath, target.path);
    if (pendingItem && restored) {
      await clearLibraryItemExpirationPending(pendingItem, expiredAt).catch(() => undefined);
    }
    throw error;
  }
}

async function quarantineMediaFile(
  item: LibraryItem,
  target: Extract<LocalMediaTarget, { ok: true }>,
  uploadsRootReal: string,
  expiredAt: string,
) {
  const safeId = safeStoredName(item.id) || "item";
  const quarantineRoot = resolve(uploadsRoot, quarantineDirName);
  await mkdir(quarantineRoot, { recursive: true });
  const quarantineRootReal = await realpath(quarantineRoot);
  if (!isSameOrChildPath(quarantineRootReal, uploadsRootReal)) {
    throw new Error("retention quarantine root escaped uploads root");
  }
  const quarantinePath = resolve(quarantineRoot, `${safeId}-${Date.parse(expiredAt) || Date.now()}-${basename(target.path)}`);
  if (!isSameOrChildPath(quarantinePath, quarantineRoot)) {
    throw new Error("retention quarantine target escaped quarantine root");
  }
  if (dirname(quarantinePath) !== quarantineRoot) {
    throw new Error("retention quarantine target must stay directly under quarantine root");
  }
  await rename(target.path, quarantinePath);
  return quarantinePath;
}

async function findQuarantinedMediaFile(
  item: LibraryItem,
  target: Extract<LocalMediaTarget, { ok: true }>,
  uploadsRootReal: string,
) {
  if (!item.expirationPending && !item.expirationPendingStoredName) return null;
  const quarantineRoot = resolve(uploadsRoot, quarantineDirName);
  let quarantineRootReal;
  try {
    quarantineRootReal = await realpath(quarantineRoot);
  } catch {
    return null;
  }
  if (!isSameOrChildPath(quarantineRootReal, uploadsRootReal)) return null;
  const safeId = safeStoredName(item.id) || "item";
  const suffix = `-${basename(target.path)}`;
  const entries = await readdir(quarantineRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.startsWith(`${safeId}-`) || !entry.name.endsWith(suffix)) continue;
    const candidate = resolve(quarantineRoot, entry.name);
    if (!isSameOrChildPath(candidate, quarantineRoot)) continue;
    return candidate;
  }
  return null;
}

async function restoreQuarantinedFile(quarantinePath: string, originalPath: string) {
  try {
    await rename(quarantinePath, originalPath);
    return true;
  } catch {
    return false;
  }
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
  if (item.expired) return false;
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
  return safeRel.replace(/[^\w./-]/g, "_");
}
