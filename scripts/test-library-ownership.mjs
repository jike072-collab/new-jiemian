#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const outDir = join(root, "dist", "library-tests");

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (existsSync(outDir)) {
  rmSync(outDir, { recursive: true, force: true });
}

run("npx", ["tsc", "-p", "tsconfig.library-tests.json"]);
run("node", [
  "--conditions=react-server",
  "--test",
  "--test-timeout=30000",
  "dist/library-tests/src/lib/server/__tests__/library-ownership.test.js",
  "dist/library-tests/src/lib/server/__tests__/tunneltest-limits.test.js",
  "dist/library-tests/src/lib/server/__tests__/tunneltest-reference-images.test.js",
]);
