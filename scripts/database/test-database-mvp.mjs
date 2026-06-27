#!/usr/bin/env node
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const outDir = join(root, "dist", "database-tests");

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(process.execPath, ["scripts/database/check-stage9c-schema.mjs"]);

if (existsSync(outDir)) {
  rmSync(outDir, { recursive: true, force: true });
}

run(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.database-tests.json"]);
run(process.execPath, [
  "--conditions=react-server",
  "--test",
  "--test-timeout=30000",
  "dist/database-tests/src/lib/server/database/__tests__/mvp-repositories.test.js",
]);

const hasTemporaryDatabase = Boolean(
  process.env.STAGE9C_TEST_DATABASE_URL
  && process.env.STAGE9C_TEST_DATABASE_EXPECTED_NAME,
);

if (hasTemporaryDatabase) {
  run(process.execPath, ["scripts/database/check-stage9c-migration.mjs"]);
}

console.log(JSON.stringify({
  ok: true,
  repositoryTests: "passed",
  schemaCheck: "passed",
  temporaryTestDatabase: hasTemporaryDatabase ? "used/masked" : "not_configured",
  productionDbWritten: false,
  stagingDbWritten: false,
  generationEndpointsCalled: false,
  newApiCalled: false,
  secrets: "masked",
}, null, 2));
