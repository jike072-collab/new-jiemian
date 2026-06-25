#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { readdir } from "node:fs/promises";

const root = process.cwd();
const runtimeRoots = ["src/lib/server", "src/app/api"];
const allowFiles = new Set([
  "src/lib/server/runtime-paths.ts",
  "src/lib/server/paths.ts",
]);
const forbiddenPatterns = [
  /join\s*\(\s*process\.cwd\s*\(\s*\)\s*,\s*["'](?:data|uploads)["']/,
  /resolve\s*\(\s*process\.cwd\s*\(\s*\)\s*,\s*["'](?:data|uploads)["']/,
  /["']\.\/(?:data|uploads)["']/,
  /["'](?:data|uploads)\/["']/,
];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") continue;
      files.push(...await walk(full));
    } else if (/\.(ts|tsx|js|mjs)$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
      files.push(full);
    }
  }
  return files;
}

function posixRelative(file) {
  return relative(root, file).replace(/\\/g, "/");
}

const violations = [];
for (const runtimeRoot of runtimeRoots) {
  for (const file of await walk(join(root, runtimeRoot))) {
    const rel = posixRelative(file);
    if (allowFiles.has(rel)) continue;
    const content = await readFile(file, "utf8");
    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (forbiddenPatterns.some((pattern) => pattern.test(line))) {
        violations.push(`${rel}:${index + 1}: ${line.trim()}`);
      }
    });
  }
}

if (violations.length) {
  console.error("发现运行时代码绕过统一路径模块：");
  console.error(violations.join("\n"));
  process.exit(1);
}

console.log("runtime path usage check passed");

export const __filename = fileURLToPath(import.meta.url);
