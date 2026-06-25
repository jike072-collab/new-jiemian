import { mkdir } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

function runtimeDir(envName: "DATA_DIR" | "UPLOADS_DIR", fallback: string) {
  const value = process.env[envName]?.trim() || fallback;
  return isAbsolute(value) ? value : resolve(/* turbopackIgnore: true */ process.cwd(), value);
}

export function getDataDir() {
  return runtimeDir("DATA_DIR", "data");
}

export function getUploadsDir() {
  return runtimeDir("UPLOADS_DIR", "uploads");
}

export async function ensureDataDir() {
  await mkdir(getDataDir(), { recursive: true });
}

export async function ensureUploadsDir() {
  await mkdir(getUploadsDir(), { recursive: true });
}

export function resolveDataPath(fileName: string) {
  return join(getDataDir(), fileName);
}

export function resolveUploadPath(fileName: string) {
  return join(getUploadsDir(), fileName);
}
