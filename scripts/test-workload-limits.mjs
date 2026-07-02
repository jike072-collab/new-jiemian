#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const outDir = join(root, "dist", "workload-limits-tests");

if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });

const compile = spawnSync("npx", ["tsc", "-p", "tsconfig.workload-limits-tests.json"], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (compile.status !== 0) process.exit(compile.status ?? 1);

const run = spawnSync("node", [
  "--conditions=react-server",
  "--test",
  "dist/workload-limits-tests/src/lib/server/__tests__/workload-guard.test.js",
], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});

process.exit(run.status ?? 1);

