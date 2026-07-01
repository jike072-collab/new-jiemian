import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { access, readFile, rename, unlink, writeFile } from "node:fs/promises";

import {
  dataRoot,
  ensureRuntimeDirs,
  runtimeFileUrl,
  safeStoredName,
  readJsonFile,
  resolveUploadPath,
  writeJsonFile,
} from "./paths";
import { type JobRecord, type LibraryItem } from "./types";
import { createStage9cbLibraryDatabaseAdapter } from "./database/library-jobs-adapter";
import { scheduleLibraryShadowWrite } from "./database/library-shadow-write";
import {
  getStage9cbDatabaseIntegrationFlags,
  shouldReadLibraryFromDatabase,
  shouldUseDatabaseJobs,
  shouldWriteLibraryToDatabase,
} from "./database/stage9cb-flags";
import {
  allowedImageMimeTypes,
  allowedVideoMimeTypes,
  formatByteLimit,
  normalizeMimeType,
  type RemoteMediaKind,
} from "../upload-limits";
import { attachMediaRetentionMetadata } from "../media-retention";
import { assertStorageAllows } from "./storage-capacity";
import { storeRemoteUrlStreamed } from "./remote-media-download";
import { assertBufferLengthAllowed, currentRemoteMediaLimitBytes } from "./media-upload-guard";

const libraryPath = join(dataRoot, "library.json");
const jobsPath = join(dataRoot, "jobs.json");
let libraryWriteQueue = Promise.resolve();
let jobsWriteQueue = Promise.resolve();
let databaseAdapter: ReturnType<typeof createStage9cbLibraryDatabaseAdapter> | null = null;

export class LibraryOperationError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "LibraryOperationError";
    this.status = status;
  }
}

async function serializeWrite<T>(queue: "library" | "jobs", action: () => Promise<T>) {
  const previous = queue === "library" ? libraryWriteQueue : jobsWriteQueue;
  let release: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  if (queue === "library") libraryWriteQueue = previous.then(() => current, () => current);
  else jobsWriteQueue = previous.then(() => current, () => current);

  await previous.catch(() => undefined);
  try {
    return await action();
  } finally {
    release!();
  }
}

async function storedFileExists(storedName: string) {
  const safeName = safeStoredName(storedName);
  if (!safeName || safeName !== storedName) return false;
  try {
    await access(resolveUploadPath(safeName));
    return true;
  } catch {
    return false;
  }
}

async function readLibraryFile() {
  return readJsonFile<LibraryItem[]>(libraryPath, []);
}

async function readJobsFile() {
  return readJsonFile<JobRecord[]>(jobsPath, []);
}

async function saveJobsFile(jobs: JobRecord[]) {
  await writeJsonFile(jobsPath, jobs);
}

function getDatabaseAdapter() {
  databaseAdapter ||= createStage9cbLibraryDatabaseAdapter();
  return databaseAdapter;
}

function safeOutputPath(storedName: string) {
  const safeName = safeStoredName(storedName);
  if (!safeName || safeName !== storedName) {
    throw new LibraryOperationError(400, "作品文件名无效。");
  }
  return resolveUploadPath(safeName);
}

async function removeStoredOutputFile(storedName: string) {
  const outputPath = safeOutputPath(storedName);
  try {
    await unlink(outputPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw new LibraryOperationError(500, "删除作品文件失败，请稍后重试。");
  }
}

function isOwnedBy(item: LibraryItem, ownerLocalUserId: string) {
  return item.ownerLocalUserId === ownerLocalUserId;
}

function withRetentionMetadata(item: LibraryItem) {
  return attachMediaRetentionMetadata(item);
}

function applyLibraryItemPatch(item: LibraryItem, patch: Partial<LibraryItem>, updatedAt: string) {
  const completedAt = patch.status === "done" && item.status !== "done" && !patch.completedAt && !item.completedAt
    ? updatedAt
    : patch.completedAt;
  return {
    ...item,
    ...patch,
    ...(completedAt ? { completedAt } : {}),
    updatedAt,
  };
}

async function updateLibraryItemFile(id: string, patch: Partial<LibraryItem>, updatedAt = new Date().toISOString()) {
  if (testFailureInjectionAllowed() && process.env.AOHUANG_TEST_FAIL_LIBRARY_UPDATE_ID === id) {
    throw new LibraryOperationError(500, "Simulated library update failure.");
  }
  return serializeWrite("library", async () => {
    const items = await readLibraryFile();
    const next = items.map((item) => (
      item.id === id ? applyLibraryItemPatch(item, patch, updatedAt) : item
    ));
    await saveLibrary(next);
    return next.find((item) => item.id === id) || null;
  });
}

export async function readLibrary() {
  const flags = getStage9cbDatabaseIntegrationFlags();
  if (shouldReadLibraryFromDatabase(flags)) {
    return (await getDatabaseAdapter().readLibrary()).map(withRetentionMetadata);
  }

  const items = await readLibraryFile();
  const withFileState = await Promise.all(items.map(async (item) => {
    const withRetention = withRetentionMetadata(item);
    if (!withRetention.output?.storedName) return withRetention;
    return {
      ...withRetention,
      fileAvailable: await storedFileExists(withRetention.output.storedName),
    };
  }));
  return withFileState.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function readLibraryForOwner(ownerLocalUserId: string) {
  return (await readLibrary()).filter((item) => isOwnedBy(item, ownerLocalUserId));
}

export async function saveLibrary(items: LibraryItem[]) {
  await writeJsonFile(libraryPath, items);
}

export async function addLibraryItem(input: Omit<LibraryItem, "id" | "createdAt" | "updatedAt">) {
  const now = new Date().toISOString();
  const item: LibraryItem = {
    ...input,
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    ...(input.status === "done" && !input.completedAt ? { completedAt: now } : {}),
  };
  await serializeWrite("library", async () => {
    const items = await readLibraryFile();
    await saveLibrary([item, ...items]);
  });
  if (shouldWriteLibraryToDatabase(getStage9cbDatabaseIntegrationFlags())) {
    void scheduleLibraryShadowWrite({ operation: "addLibraryItem", item }, { adapter: getDatabaseAdapter() });
  }
  return item;
}

export async function updateLibraryItem(id: string, patch: Partial<LibraryItem>) {
  const updated = await updateLibraryItemFile(id, patch);
  if (updated && shouldWriteLibraryToDatabase(getStage9cbDatabaseIntegrationFlags())) {
    void scheduleLibraryShadowWrite({
      operation: "updateLibraryItem",
      id,
      patch,
      nextItem: updated,
    }, { adapter: getDatabaseAdapter() });
  }
  return updated;
}

export async function expireLibraryItemMedia(item: LibraryItem, expiredAt: string) {
  const patch: Partial<LibraryItem> = {
    output: undefined,
    expired: true,
    expiredAt,
    expiresAt: expiredAt,
    expirationPending: undefined,
    expirationStage: undefined,
    expirationPendingAt: undefined,
    expirationPendingStoredName: undefined,
    expirationQuarantineName: undefined,
    fileAvailable: false,
  };
  const nextItem: LibraryItem = {
    ...item,
    ...patch,
    updatedAt: expiredAt,
  };
  if (shouldSimulateExpirationFinalJsonFailure(item.id)) {
    throw new LibraryOperationError(500, "Simulated expiration final JSON failure.");
  }
  const updated = await updateLibraryItemFile(item.id, patch, expiredAt);
  const persisted = updated || nextItem;
  const flags = getStage9cbDatabaseIntegrationFlags();
  if (shouldWriteLibraryToDatabase(flags)) {
    if (item.expirationStage === "fileDeleted" && shouldSimulateExpirationFinalDatabaseFailure(item.id)) {
      await updateLibraryItemFile(item.id, {
        output: item.output,
        expired: item.expired,
        expiredAt: item.expiredAt,
        expiresAt: item.expiresAt,
        expirationPending: item.expirationPending,
        expirationStage: item.expirationStage,
        expirationPendingAt: item.expirationPendingAt,
        expirationPendingStoredName: item.expirationPendingStoredName,
        expirationQuarantineName: item.expirationQuarantineName,
        fileAvailable: item.fileAvailable,
      }, item.updatedAt);
      throw new LibraryOperationError(500, "Simulated expiration pending database failure.");
    }
    if (shouldSimulateDatabaseWritesForItem(item.id)) return persisted;
    const databaseUpdated = await getDatabaseAdapter().updateLibraryItem(item.id, patch, persisted).catch(async (error) => {
      await updateLibraryItemFile(item.id, {
        output: item.output,
        expired: item.expired,
        expiredAt: item.expiredAt,
        expiresAt: item.expiresAt,
        expirationPending: item.expirationPending,
        expirationStage: item.expirationStage,
        expirationPendingAt: item.expirationPendingAt,
        expirationPendingStoredName: item.expirationPendingStoredName,
        expirationQuarantineName: item.expirationQuarantineName,
        fileAvailable: item.fileAvailable,
      }, item.updatedAt);
      throw error;
    });
    if (!databaseUpdated) {
      await updateLibraryItemFile(item.id, {
        output: item.output,
        expired: item.expired,
        expiredAt: item.expiredAt,
        expiresAt: item.expiresAt,
        expirationPending: item.expirationPending,
        expirationStage: item.expirationStage,
        expirationPendingAt: item.expirationPendingAt,
        expirationPendingStoredName: item.expirationPendingStoredName,
        expirationQuarantineName: item.expirationQuarantineName,
        fileAvailable: item.fileAvailable,
      }, item.updatedAt);
      throw new LibraryOperationError(500, "作品过期状态同步失败。");
    }
  }
  return persisted;
}

function testFailureInjectionAllowed() {
  return process.env.NODE_ENV === "test"
    || (
      process.env.PORT === "3107"
      && process.env.RUNTIME_STORAGE_ISOLATION === "strict"
      && process.env.AOHUANG_ALLOW_RUNTIME_DIR_OVERRIDE === "1"
    );
}

function shouldSimulateExpirationPendingDatabaseFailure(itemId: string) {
  if (!testFailureInjectionAllowed()) return false;
  const target = process.env.AOHUANG_TEST_FAIL_EXPIRATION_PENDING_DATABASE;
  return target === itemId || target === "*" || target === "__all__";
}

function shouldSimulateExpirationFinalDatabaseFailure(itemId: string) {
  if (!testFailureInjectionAllowed()) return false;
  const target = process.env.AOHUANG_TEST_FAIL_EXPIRATION_FINAL_DATABASE;
  return target === itemId || target === "*" || target === "__all__";
}

function shouldSimulateExpirationStageDatabaseFailure(itemId: string) {
  if (!testFailureInjectionAllowed()) return false;
  const target = process.env.AOHUANG_TEST_FAIL_EXPIRATION_STAGE_DATABASE;
  return target === itemId || target === "*" || target === "__all__";
}

function shouldSimulateExpirationFinalJsonFailure(itemId: string) {
  if (!testFailureInjectionAllowed()) return false;
  const target = process.env.AOHUANG_TEST_FAIL_EXPIRATION_FINAL_JSON;
  return target === itemId || target === "*" || target === "__all__";
}

function shouldSimulateDatabaseWritesForItem(itemId: string) {
  if (!testFailureInjectionAllowed()) return false;
  const value = process.env.AOHUANG_TEST_SIMULATE_DATABASE_WRITES;
  if (!value) return false;
  if (value === "1" || value === "true") return true;
  if (value.startsWith("except:")) {
    return value.slice("except:".length) !== itemId;
  }
  return value === itemId || value === "*" || value === "__all__";
}

export async function markLibraryItemExpirationPending(item: LibraryItem, pendingAt: string, storedName: string) {
  const quarantineName = item.expirationQuarantineName || safeStoredName(`media-expiration-${item.id}-${pendingAt}-${storedName}`);
  const patch: Partial<LibraryItem> = {
    expirationPending: true,
    expirationStage: "pending",
    expirationPendingAt: pendingAt,
    expirationPendingStoredName: storedName,
    expirationQuarantineName: quarantineName,
    fileAvailable: false,
  };
  const nextItem: LibraryItem = {
    ...item,
    ...patch,
    updatedAt: pendingAt,
  };
  const updated = await updateLibraryItemFile(item.id, patch, pendingAt);
  const persisted = updated || nextItem;
  const flags = getStage9cbDatabaseIntegrationFlags();
  if (shouldWriteLibraryToDatabase(flags)) {
    if (shouldSimulateExpirationPendingDatabaseFailure(item.id)) {
      await updateLibraryItemFile(item.id, {
        expirationPending: item.expirationPending,
        expirationStage: item.expirationStage,
        expirationPendingAt: item.expirationPendingAt,
        expirationPendingStoredName: item.expirationPendingStoredName,
        expirationQuarantineName: item.expirationQuarantineName,
        fileAvailable: item.fileAvailable,
      }, item.updatedAt);
      throw new LibraryOperationError(500, "Simulated expiration pending database failure.");
    }
    if (shouldSimulateDatabaseWritesForItem(item.id)) return persisted;
    const databaseUpdated = await getDatabaseAdapter().updateLibraryItem(item.id, patch, persisted).catch(async (error) => {
      await updateLibraryItemFile(item.id, {
        expirationPending: item.expirationPending,
        expirationStage: item.expirationStage,
        expirationPendingAt: item.expirationPendingAt,
        expirationPendingStoredName: item.expirationPendingStoredName,
        expirationQuarantineName: item.expirationQuarantineName,
        fileAvailable: item.fileAvailable,
      }, item.updatedAt);
      throw error;
    });
    if (!databaseUpdated) {
      await updateLibraryItemFile(item.id, {
        expirationPending: item.expirationPending,
        expirationStage: item.expirationStage,
        expirationPendingAt: item.expirationPendingAt,
        expirationPendingStoredName: item.expirationPendingStoredName,
        expirationQuarantineName: item.expirationQuarantineName,
        fileAvailable: item.fileAvailable,
      }, item.updatedAt);
      throw new LibraryOperationError(500, "作品过期待处理状态同步失败。");
    }
  }
  return persisted;
}

export async function markLibraryItemExpirationStage(
  item: LibraryItem,
  stage: "quarantined" | "fileDeleted",
  updatedAt: string,
) {
  const patch: Partial<LibraryItem> = {
    expirationPending: true,
    expirationStage: stage,
    expirationPendingAt: item.expirationPendingAt || updatedAt,
    expirationPendingStoredName: item.expirationPendingStoredName || item.output?.storedName,
    expirationQuarantineName: item.expirationQuarantineName,
    fileAvailable: false,
  };
  const nextItem: LibraryItem = {
    ...item,
    ...patch,
    updatedAt,
  };
  const updated = await updateLibraryItemFile(item.id, patch, updatedAt);
  const persisted = updated || nextItem;
  const flags = getStage9cbDatabaseIntegrationFlags();
  if (shouldWriteLibraryToDatabase(flags)) {
    if (shouldSimulateExpirationStageDatabaseFailure(item.id)) {
      throw new LibraryOperationError(500, "Simulated expiration final database failure.");
    }
    if (shouldSimulateDatabaseWritesForItem(item.id)) return persisted;
    const databaseUpdated = await getDatabaseAdapter().updateLibraryItem(item.id, patch, persisted);
    if (!databaseUpdated) {
      throw new LibraryOperationError(500, "Library expiration stage synchronization failed.");
    }
  }
  return persisted;
}

export async function clearLibraryItemExpirationPending(item: LibraryItem, restoredAt: string) {
  const patch: Partial<LibraryItem> = {
    expirationPending: undefined,
    expirationStage: undefined,
    expirationPendingAt: undefined,
    expirationPendingStoredName: undefined,
    expirationQuarantineName: undefined,
    fileAvailable: Boolean(item.output?.storedName),
  };
  const nextItem: LibraryItem = {
    ...item,
    ...patch,
    updatedAt: restoredAt,
  };
  const updated = await updateLibraryItemFile(item.id, patch, restoredAt);
  const persisted = updated || nextItem;
  const flags = getStage9cbDatabaseIntegrationFlags();
  if (shouldWriteLibraryToDatabase(flags)) {
    if (shouldSimulateDatabaseWritesForItem(item.id)) return persisted;
    const databaseUpdated = await getDatabaseAdapter().updateLibraryItem(item.id, patch, persisted);
    if (!databaseUpdated) {
      await updateLibraryItemFile(item.id, {
        expirationPending: item.expirationPending,
        expirationStage: item.expirationStage,
        expirationPendingAt: item.expirationPendingAt,
        expirationPendingStoredName: item.expirationPendingStoredName,
        expirationQuarantineName: item.expirationQuarantineName,
        fileAvailable: item.fileAvailable,
      }, item.updatedAt);
      throw new LibraryOperationError(500, "作品过期待处理状态恢复失败。");
    }
  }
  return persisted;
}

export async function deleteLibraryItem(id: string) {
  if (shouldReadLibraryFromDatabase(getStage9cbDatabaseIntegrationFlags())) {
    return getDatabaseAdapter().softDeleteLibraryItem(id);
  }

  const removed = await serializeWrite("library", async () => {
    const items = await readLibraryFile();
    const removedItem = items.find((item) => item.id === id);
    if (!removedItem) throw new LibraryOperationError(404, "作品不存在。");
    if (removedItem.output?.storedName) await removeStoredOutputFile(removedItem.output.storedName);
    const next = items.filter((item) => item.id !== id);
    await saveLibrary(next);
    return removedItem;
  });
  await serializeWrite("jobs", async () => {
    const jobs = await readJobsFile();
    await saveJobsFile(jobs.filter((job) => job.libraryItemId !== id));
  });
  if (shouldWriteLibraryToDatabase(getStage9cbDatabaseIntegrationFlags())) {
    void scheduleLibraryShadowWrite({ operation: "softDeleteLibraryItem", id }, { adapter: getDatabaseAdapter() });
  }
  return { deleted: Boolean(removed) };
}

export async function deleteLibraryItemForOwner(id: string, ownerLocalUserId: string) {
  const flags = getStage9cbDatabaseIntegrationFlags();
  if (shouldReadLibraryFromDatabase(flags)) {
    const item = (await readLibrary()).find((candidate) => candidate.id === id && isOwnedBy(candidate, ownerLocalUserId));
    if (!item) throw new LibraryOperationError(404, "Library item not found.");
    return getDatabaseAdapter().softDeleteLibraryItem(id);
  }

  const removed = await serializeWrite("library", async () => {
    const items = await readLibraryFile();
    const removedItem = items.find((item) => item.id === id && isOwnedBy(item, ownerLocalUserId));
    if (!removedItem) throw new LibraryOperationError(404, "Library item not found.");
    if (removedItem.output?.storedName) await removeStoredOutputFile(removedItem.output.storedName);
    const next = items.filter((item) => item.id !== id);
    await saveLibrary(next);
    return removedItem;
  });
  await serializeWrite("jobs", async () => {
    const jobs = await readJobsFile();
    await saveJobsFile(jobs.filter((job) => job.libraryItemId !== id));
  });
  if (shouldWriteLibraryToDatabase(flags)) {
    await getDatabaseAdapter().softDeleteLibraryItem(id);
  }
  return { deleted: Boolean(removed) };
}

export async function readJobs() {
  if (shouldUseDatabaseJobs(getStage9cbDatabaseIntegrationFlags())) {
    return getDatabaseAdapter().readJobs();
  }
  return readJobsFile();
}

export async function saveJobs(jobs: JobRecord[]) {
  await saveJobsFile(jobs);
}

export async function addJob(job: Omit<JobRecord, "createdAt" | "updatedAt">) {
  const now = new Date().toISOString();
  const record: JobRecord = { ...job, createdAt: now, updatedAt: now };
  await serializeWrite("jobs", async () => {
    const jobs = await readJobsFile();
    await saveJobsFile([record, ...jobs]);
  });
  if (shouldUseDatabaseJobs(getStage9cbDatabaseIntegrationFlags())) {
    await getDatabaseAdapter().addJob(record);
  }
  return record;
}

export async function updateJob(id: string, patch: Partial<JobRecord>) {
  return serializeWrite("jobs", async () => {
    const jobs = await readJobsFile();
    const next = jobs.map((job) => (
      job.id === id ? { ...job, ...patch, updatedAt: new Date().toISOString() } : job
    ));
    await saveJobsFile(next);
    const updated = next.find((job) => job.id === id) || null;
    if (updated && shouldUseDatabaseJobs(getStage9cbDatabaseIntegrationFlags())) {
      await getDatabaseAdapter().updateJob(updated);
    }
    return updated;
  });
}

export function extensionForMime(mimeType: string, fallback = ".bin") {
  const normalized = mimeType.split(";")[0].trim().toLowerCase();
  if (normalized === "image/png") return ".png";
  if (normalized === "image/jpeg") return ".jpg";
  if (normalized === "image/webp") return ".webp";
  if (normalized === "video/webm") return ".webm";
  if (normalized === "video/quicktime") return ".mov";
  if (normalized === "video/mp4") return ".mp4";
  return fallback;
}

export async function storeBytes(bytes: Buffer, mimeType: string, prefix: string) {
  await ensureRuntimeDirs();
  const normalizedMime = normalizeMimeType(mimeType);
  const kind = remoteMediaKind(normalizedMime, prefix);
  assertStoreMimeAllowed(kind, normalizedMime);
  assertBufferLengthAllowed(bytes.length, kind);
  await assertStorageAllows(kind === "video" ? "video-media-write" : "image-media-write", { fresh: true });
  const safePrefix = safeStoredName(prefix) || "media";
  const storedName = safeStoredName(`${safePrefix}-${randomUUID()}${extensionForMime(normalizedMime)}`);
  const tempName = safeStoredName(`.store-${safePrefix}-${randomUUID()}.tmp`);
  const tempPath = resolveUploadPath(tempName);
  const target = resolveUploadPath(storedName);
  try {
    await writeFile(tempPath, bytes, { mode: 0o600, flag: "wx" });
    await rename(tempPath, target);
    return {
      storedName,
      url: runtimeFileUrl(storedName),
      mimeType: normalizedMime,
      size: bytes.length,
    };
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    await unlink(target).catch(() => undefined);
    throw error;
  }
}

export async function storeDataUrl(dataUrl: string, prefix: string) {
  const match = dataUrl.match(/^data:([^;,\s]+);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) throw new Error("供应商返回了无效的 data URL。");
  const mimeType = normalizeMimeType(match[1]);
  const kind = remoteMediaKind(mimeType, prefix);
  assertStoreMimeAllowed(kind, mimeType);
  const base64 = match[2];
  const estimatedBytes = estimateBase64DecodedBytes(base64);
  const limit = currentRemoteMediaLimitBytes(kind);
  if (estimatedBytes > limit) {
    throw new Error(`${kind === "video" ? "瑙嗛" : "鍥剧墖"}涓嶈兘瓒呰繃${formatByteLimit(limit)}`);
  }
  await assertStorageAllows(kind === "video" ? "video-media-write" : "image-media-write", { fresh: true });
  const bytes = Buffer.from(base64, "base64");
  assertBufferLengthAllowed(bytes.length, kind);
  return storeBytes(bytes, mimeType, prefix);
}

export async function storeRemoteUrl(url: string, prefix: string, fallbackMime: string) {
  return storeRemoteUrlStreamed(url, { prefix, fallbackMime });
}

export function remoteMediaKind(mimeType: string, prefix: string): RemoteMediaKind {
  return mimeType.toLowerCase().includes("video") || prefix.toLowerCase().includes("video") ? "video" : "image";
}

function assertStoreMimeAllowed(kind: RemoteMediaKind, mimeType: string) {
  if (kind === "image" && allowedImageMimeTypes.includes(mimeType as (typeof allowedImageMimeTypes)[number])) return;
  if (kind === "video" && allowedVideoMimeTypes.includes(mimeType as (typeof allowedVideoMimeTypes)[number])) return;
  throw new Error("Remote media type is not supported.");
}

function estimateBase64DecodedBytes(base64: string) {
  if (base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new Error("Invalid data URL.");
  }
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor(base64.length / 4) * 3 - padding;
}

export const libraryStorageInternalsForTests = {
  estimateBase64DecodedBytes,
};

export async function readStoredFile(storedName: string) {
  const safeName = safeStoredName(storedName);
  if (!safeName || safeName !== storedName) return null;
  try {
    return await readFile(resolveUploadPath(safeName));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function readStoredFileForOwner(storedName: string, ownerLocalUserId: string) {
  const safeName = safeStoredName(storedName);
  if (!safeName || safeName !== storedName) return null;
  const item = (await readLibrary()).find((candidate) => (
    isOwnedBy(candidate, ownerLocalUserId)
    && candidate.output?.storedName === storedName
  ));
  if (!item) return null;
  return readStoredFile(storedName);
}
