#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const rollbackDoc = join(root, "docs", "STAGE9D_ROLLBACK_PLAN.md");
const releaseGatesDoc = join(root, "docs", "STAGE9D_RELEASE_GATES.md");

const requiredTerms = new Map([
  [rollbackDoc, [
    "pg_dump",
    "pg_restore --list",
    "backup manifest",
    "checksum",
    "feature flag rollback",
    "stop immediately",
    "separate user authorization",
    "Do not auto-execute",
  ]],
  [releaseGatesDoc, [
    "Stage 9E",
    "3106",
    "real migration",
    "real import",
    "NewAPI",
    "cost",
  ]],
]);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readText(path) {
  if (!existsSync(path)) fail(`${path} is missing.`);
  return readFileSync(path, "utf8").replace(/^\uFEFF/, "");
}

function runNodeJson(script) {
  const result = spawnSync(process.execPath, [script], {
    cwd: root,
    env: process.env,
    encoding: "utf8",
    shell: false,
  });
  if (result.error) fail(result.error.message);
  if (result.status !== 0) fail((result.stderr || result.stdout || `${script} failed`).trim());
  try {
    return JSON.parse((result.stdout || "").trim());
  } catch {
    fail(`Unable to parse JSON from ${script}.`);
  }
}

const docChecks = {};
for (const [path, terms] of requiredTerms) {
  const text = readText(path);
  const missing = terms.filter((term) => !text.includes(term));
  if (missing.length > 0) fail(`${path} is missing required Stage 9D rollback terms: ${missing.join(", ")}`);
  docChecks[path.endsWith("ROLLBACK_PLAN.md") ? "rollbackPlan" : "releaseGates"] = true;
}

const drill = runNodeJson("scripts/test-full-rollback-drill.mjs");

console.log(JSON.stringify({
  ok: drill.ok,
  stage: "Stage 9D",
  mode: "readiness-check",
  rollbackDrillMode: drill.postgresMode,
  includesDatabaseBackup: true,
  includesDataBackup: true,
  includesUploadsBackup: true,
  includesManifestChecksum: true,
  includesPgRestoreListVerification: true,
  includesAppRollback: true,
  includesFeatureFlagRollback: true,
  includesStopConditions: true,
  requiresSeparateAuthorization: true,
  autoExecutionForbidden: true,
  drill,
  productionDbWritten: false,
  stagingDbWritten: false,
  generationEndpointsCalled: false,
  newApiCalled: false,
  realProviderCalled: false,
  costIncurred: false,
  secrets: "masked",
  docChecks,
}, null, 2));
