import { lstat, realpath, stat, unlink } from "node:fs/promises";
import { basename, relative, resolve, sep } from "node:path";

import { mediaCompletedAt, mediaExpiresAt, resolveMediaRetentionHours } from "../media-retention";
import { ensureRuntimeDirs, resolveUploadPath, safeStoredName, uploadsRoot } from "./paths";
import { expireLibraryItemMedia, readJobs, readLibrary } from "./library";
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
      if (target.exists) {
        await unlink(target.path);
        result.deletedFiles += 1;
      }
      await expireLibraryItemMedia(item, now.toISOString());
      result.expiredItems += 1;
    } catch {
      result.ok = false;
      result.errors.push({ id: item.id, code: "expire_media_failed" });
    }
  }

  return result;
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
  if (!item.output?.storedName) return false;
  const completedAt = new Date(mediaCompletedAt(item));
  if (Number.isNaN(completedAt.getTime())) return false;
  const expiresAt = mediaExpiresAt(item, retentionHours);
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() <= now.getTime();
}

async function resolveLocalMediaTarget(item: LibraryItem, uploadsRootReal: string): Promise<LocalMediaTarget> {
  const storedName = item.output?.storedName || "";
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
