import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const outDir = join(root, "dist", "new-api-bff-tests");

if (existsSync(outDir)) {
  rmSync(outDir, { recursive: true, force: true });
}

const compile = spawnSync("npx", ["tsc", "-p", "tsconfig.new-api-bff-tests.json"], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (compile.status !== 0) process.exit(compile.status ?? 1);

const tests = process.argv.includes("--real")
  ? ["dist/new-api-bff-tests/src/lib/server/integrations/new-api/__tests__/real-new-api.test.js"]
  : [
      "dist/new-api-bff-tests/src/lib/server/integrations/new-api/__tests__/client.test.js",
      "dist/new-api-bff-tests/src/lib/server/integrations/new-api/__tests__/bundle-boundary.test.js",
    ];

const run = spawnSync("node", ["--test", ...tests], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});

process.exit(run.status ?? 1);
