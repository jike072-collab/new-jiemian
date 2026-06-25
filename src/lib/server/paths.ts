import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

import { getDataDir, getUploadsDir } from "./runtime-paths";

export const dataRoot = getDataDir();
export const uploadsRoot = getUploadsDir();

export async function ensureRuntimeDirs() {
  await Promise.all([
    mkdir(dataRoot, { recursive: true }),
    mkdir(uploadsRoot, { recursive: true }),
  ]);
}

export async function readJsonFile<T>(path: string, fallback: T): Promise<T> {
  try {
    const text = await readFile(path, "utf8");
    return JSON.parse(text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

export async function writeJsonFile(path: string, value: unknown) {
  await ensureRuntimeDirs();
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

export function runtimeFileUrl(storedName: string) {
  return `/api/files/${encodeURIComponent(storedName)}`;
}

export function safeStoredName(name: string) {
  return name.replace(/[^a-z0-9._-]+/gi, "-").replace(/^[.-]+|[.-]+$/g, "");
}
