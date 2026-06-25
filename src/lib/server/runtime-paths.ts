import { mkdir } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

type RuntimeStorageEnv = Record<string, string | undefined>;

export type RuntimeStorageIsolationReport = {
  port: string;
  strict: boolean;
  dataDir: string;
  uploadsDir: string;
  defaultDataDir: string;
  defaultUploadsDir: string;
};

export class RuntimeStorageIsolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeStorageIsolationError";
  }
}

function envValue(env: RuntimeStorageEnv, name: "DATA_DIR" | "UPLOADS_DIR") {
  return env[name]?.trim() || "";
}

function resolveRuntimeDir(value: string, fallback: string, cwd: string) {
  const target = value || fallback;
  return isAbsolute(target) ? resolve(target) : resolve(/* turbopackIgnore: true */ cwd, target);
}

function runtimeDir(envName: "DATA_DIR" | "UPLOADS_DIR", fallback: string, env = process.env, cwd = process.cwd()) {
  return resolveRuntimeDir(envValue(env, envName), fallback, cwd);
}

function comparePath(path: string) {
  const normalized = resolve(path);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function samePath(left: string, right: string) {
  return comparePath(left) === comparePath(right);
}

function isInsidePath(child: string, parent: string) {
  const rel = relative(parent, child);
  return Boolean(rel) && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function assertInsideRoot(root: string, target: string) {
  if (samePath(root, target) || isInsidePath(target, root)) return;
  throw new RuntimeStorageIsolationError("运行时路径不能逃出指定的存储根目录。");
}

export function validateRuntimeStorageIsolation(
  env: RuntimeStorageEnv = process.env,
  cwd = process.cwd(),
): RuntimeStorageIsolationReport {
  const port = env.PORT?.trim() || "";
  const dataDirValue = envValue(env, "DATA_DIR");
  const uploadsDirValue = envValue(env, "UPLOADS_DIR");
  const strict = port === "3107" || env.RUNTIME_STORAGE_ISOLATION?.trim() === "strict";
  const strictLabel = port === "3107" ? "PORT=3107" : "RUNTIME_STORAGE_ISOLATION=strict";
  const defaultDataDir = resolveRuntimeDir("", "data", cwd);
  const defaultUploadsDir = resolveRuntimeDir("", "uploads", cwd);
  const dataDir = resolveRuntimeDir(dataDirValue, "data", cwd);
  const uploadsDir = resolveRuntimeDir(uploadsDirValue, "uploads", cwd);

  if (strict) {
    if (!dataDirValue) throw new RuntimeStorageIsolationError(`${strictLabel} 时必须显式设置 DATA_DIR，禁止回退到正式 data 目录。`);
    if (!uploadsDirValue) throw new RuntimeStorageIsolationError(`${strictLabel} 时必须显式设置 UPLOADS_DIR，禁止回退到正式 uploads 目录。`);
    if (samePath(dataDir, defaultDataDir)) throw new RuntimeStorageIsolationError(`${strictLabel} 时 DATA_DIR 不能使用默认 data 目录。`);
    if (samePath(uploadsDir, defaultUploadsDir)) throw new RuntimeStorageIsolationError(`${strictLabel} 时 UPLOADS_DIR 不能使用默认 uploads 目录。`);
    if (samePath(dataDir, uploadsDir)) throw new RuntimeStorageIsolationError(`${strictLabel} 时 DATA_DIR 和 UPLOADS_DIR 不能指向同一个目录。`);
    if (isInsidePath(dataDir, uploadsDir)) throw new RuntimeStorageIsolationError(`${strictLabel} 时 DATA_DIR 不能位于 UPLOADS_DIR 内部。`);
    if (isInsidePath(uploadsDir, dataDir)) throw new RuntimeStorageIsolationError(`${strictLabel} 时 UPLOADS_DIR 不能位于 DATA_DIR 内部。`);
  }

  return { port, strict, dataDir, uploadsDir, defaultDataDir, defaultUploadsDir };
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
  const root = getDataDir();
  const target = resolve(root, fileName);
  assertInsideRoot(root, target);
  return target;
}

export function resolveUploadPath(fileName: string) {
  const root = getUploadsDir();
  const target = resolve(root, fileName);
  assertInsideRoot(root, target);
  return target;
}
