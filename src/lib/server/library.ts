import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { access, readFile, unlink, writeFile } from "node:fs/promises";

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

const libraryPath = join(dataRoot, "library.json");
const jobsPath = join(dataRoot, "jobs.json");
let libraryWriteQueue = Promise.resolve();
let jobsWriteQueue = Promise.resolve();

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

export async function readLibrary() {
  const items = await readLibraryFile();
  const withFileState = await Promise.all(items.map(async (item) => {
    if (!item.output?.storedName) return item;
    return {
      ...item,
      fileAvailable: await storedFileExists(item.output.storedName),
    };
  }));
  return withFileState.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
  };
  await serializeWrite("library", async () => {
    const items = await readLibraryFile();
    await saveLibrary([item, ...items]);
  });
  return item;
}

export async function updateLibraryItem(id: string, patch: Partial<LibraryItem>) {
  return serializeWrite("library", async () => {
    const items = await readLibraryFile();
    const next = items.map((item) => (
      item.id === id ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item
    ));
    await saveLibrary(next);
    return next.find((item) => item.id === id) || null;
  });
}

export async function deleteLibraryItem(id: string) {
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
  return { deleted: Boolean(removed) };
}

export async function readJobs() {
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
  return record;
}

export async function updateJob(id: string, patch: Partial<JobRecord>) {
  return serializeWrite("jobs", async () => {
    const jobs = await readJobsFile();
    const next = jobs.map((job) => (
      job.id === id ? { ...job, ...patch, updatedAt: new Date().toISOString() } : job
    ));
    await saveJobsFile(next);
    return next.find((job) => job.id === id) || null;
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
  const storedName = safeStoredName(`${prefix}-${randomUUID()}${extensionForMime(mimeType)}`);
  const target = resolveUploadPath(storedName);
  await writeFile(target, bytes);
  return {
    storedName,
    url: runtimeFileUrl(storedName),
    mimeType,
    size: bytes.length,
  };
}

export async function storeDataUrl(dataUrl: string, prefix: string) {
  const match = dataUrl.match(/^data:([^;]+);base64,([\s\S]+)$/i);
  if (!match) throw new Error("供应商返回了无效的 data URL。");
  return storeBytes(Buffer.from(match[2], "base64"), match[1], prefix);
}

export async function storeRemoteUrl(url: string, prefix: string, fallbackMime: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error(`下载生成结果失败：HTTP ${response.status}`);
  const mimeType = response.headers.get("content-type") || fallbackMime;
  return storeBytes(Buffer.from(await response.arrayBuffer()), mimeType, prefix);
}

export async function readStoredFile(storedName: string) {
  const safeName = safeStoredName(storedName);
  if (!safeName || safeName !== storedName) return null;
  return readFile(resolveUploadPath(safeName));
}
