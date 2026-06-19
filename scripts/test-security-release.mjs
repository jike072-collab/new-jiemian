#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const outDir = join(root, "dist", "security-release-tests");

if (existsSync(outDir)) {
  rmSync(outDir, { recursive: true, force: true });
}

const compile = spawnSync("npx", ["tsc", "-p", "tsconfig.security-release-tests.json"], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (compile.status !== 0) process.exit(compile.status ?? 1);

const tests = [
  "dist/security-release-tests/src/lib/server/security/__tests__/release-check.test.js",
];

const run = spawnSync("node", ["--conditions=react-server", "--test", ...tests], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});

process.exit(run.status ?? 1);
