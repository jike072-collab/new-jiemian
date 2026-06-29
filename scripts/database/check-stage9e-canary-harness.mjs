#!/usr/bin/env node
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const outDir = join(root, "dist", "stage9e-canary");

if (existsSync(outDir)) {
  rmSync(outDir, { recursive: true, force: true });
}

const compile = spawnSync(process.execPath, [
  "node_modules/typescript/bin/tsc",
  "-p",
  "tsconfig.stage9e-canary.json",
], {
  cwd: root,
  env: process.env,
  stdio: "inherit",
  shell: false,
});

if (compile.error) {
  console.error(compile.error.message);
  process.exit(1);
}
if (compile.status !== 0) process.exit(compile.status ?? 1);

console.log(JSON.stringify({
  ok: true,
  stage: "Stage 9E C1",
  command: "check:stage9e-canary-harness",
  compileOnly: true,
  databaseConnected: false,
  productionDbConnected: false,
  stagingDbWritten: false,
  migrationExecuted: false,
  canaryBusinessOperationsExecuted: false,
  realUploadsAccessed: false,
  generationEndpointsCalled: false,
  newApiCalled: false,
  realProviderCalled: false,
  costIncurred: false,
  secrets: "masked",
}, null, 2));
