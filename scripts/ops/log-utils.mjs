import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

export function ensureDirectory(path) {
  mkdirSync(path, { recursive: true });
}

export function rotateLogFile(logFile, options = {}) {
  const maxBytes = options.maxBytes || 5 * 1024 * 1024;
  const keep = options.keep || 8;
  ensureDirectory(dirname(logFile));
  if (existsSync(logFile) && statSync(logFile).size >= maxBytes) {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
    renameSync(logFile, `${logFile}.${stamp}`);
  }
  const dir = dirname(logFile);
  const base = logFile.slice(dir.length + 1);
  const rotated = readdirSync(dir)
    .filter((name) => name.startsWith(`${base}.`))
    .sort()
    .map((name) => join(dir, name));
  for (const oldFile of rotated.slice(0, Math.max(0, rotated.length - keep))) {
    rmSync(oldFile, { force: true });
  }
  return { logFile, rotatedPrefix: `${logFile}.`, maxBytes, keep };
}
