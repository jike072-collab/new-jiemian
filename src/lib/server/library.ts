import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { readFile, unlink, writeFile } from "node:fs/promises";

import {
  dataRoot,
  ensureRuntimeDirs,
  runtimeFileUrl,
  safeStoredName,
  uploadsRoot,
  readJsonFile,
  writeJsonFile,
} from "./paths";
import { type JobRecord, type LibraryItem } from "./types";

const libraryPath = join(dataRoot, "library.json");
const jobsPath = join(dataRoot, "jobs.json");

export async function readLibrary() {
  const items = await readJsonFile<LibraryItem[]>(libraryPath, []);
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
  const items = await readLibrary();
  await saveLibrary([item, ...items]);
  return item;
}

export async function updateLibraryItem(id: string, patch: Partial<LibraryItem>) {
  const items = await readLibrary();
  const next = items.map((item) => (
    item.id === id ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item
  ));
  await saveLibrary(next);
  return next.find((item) => item.id === id) || null;
}

export async function deleteLibraryItem(id: string) {
  const items = await readLibrary();
  const removed = items.find((item) => item.id === id);
  const next = items.filter((item) => item.id !== id);
  await saveLibrary(next);
  if (removed?.output?.storedName) {
    await unlink(join(uploadsRoot, safeStoredName(removed.output.storedName))).catch(() => undefined);
  }
  return { deleted: Boolean(removed) };
}

export async function readJobs() {
  return readJsonFile<JobRecord[]>(jobsPath, []);
}

export async function saveJobs(jobs: JobRecord[]) {
  await writeJsonFile(jobsPath, jobs);
}

export async function addJob(job: Omit<JobRecord, "createdAt" | "updatedAt">) {
  const now = new Date().toISOString();
  const record: JobRecord = { ...job, createdAt: now, updatedAt: now };
  const jobs = await readJobs();
  await saveJobs([record, ...jobs]);
  return record;
}

export async function updateJob(id: string, patch: Partial<JobRecord>) {
  const jobs = await readJobs();
  const next = jobs.map((job) => (
    job.id === id ? { ...job, ...patch, updatedAt: new Date().toISOString() } : job
  ));
  await saveJobs(next);
  return next.find((job) => job.id === id) || null;
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
  const target = join(uploadsRoot, storedName);
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
  return readFile(join(uploadsRoot, safeName));
}
