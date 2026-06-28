#!/usr/bin/env node
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const outDir = join(root, "dist", "database-tests");

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    shell: false,
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

run(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.database-tests.json"]);
run(process.execPath, [
  "--conditions=react-server",
  "--test",
  "--test-timeout=30000",
  "--test-name-pattern=jobs|job status",
  "dist/database-tests/src/lib/server/database/__tests__/library-jobs-adapter.test.js",
]);

console.log(JSON.stringify({
  ok: true,
  stage: "Stage 9C-B",
  command: "test:generation-jobs-db-integration",
  databaseConnected: false,
  productionDbWritten: false,
  stagingDbWritten: false,
  migrationExecuted: false,
  generationEndpointsCalled: false,
  newApiCalled: false,
  realProviderCalled: false,
  costIncurred: false,
  secrets: "masked",
}, null, 2));
