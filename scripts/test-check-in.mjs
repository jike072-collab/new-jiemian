import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const outDir = join(root, "dist", "check-in-tests");

if (existsSync(outDir)) {
  rmSync(outDir, { recursive: true, force: true });
}

const compile = spawnSync("npx", ["tsc", "-p", "tsconfig.check-in-tests.json"], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (compile.status !== 0) process.exit(compile.status ?? 1);

const tests = [
  "dist/check-in-tests/src/lib/server/check-in/__tests__/daily-check-in-service.test.js",
];

const run = spawnSync("node", ["--conditions=react-server", "--test", ...tests], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});

process.exit(run.status ?? 1);
