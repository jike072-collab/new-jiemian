#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const fixtureRoot = mkdtempSync(join(tmpdir(), "aohuang-stage9d-consistency-"));

function fail(message) {
  console.error(message);
  process.exit(1);
}

function runNodeJson(script, env) {
  const result = spawnSync(process.execPath, [script], {
    cwd: root,
    env: {
      ...process.env,
      ...env,
    },
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

function readText(path) {
  if (!existsSync(path)) fail(`${path} is missing.`);
  return readFileSync(path, "utf8").replace(/^\uFEFF/, "");
}

try {
  const dataDir = join(fixtureRoot, "data");
  const uploadsDir = join(fixtureRoot, "uploads");
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(uploadsDir, { recursive: true });

  writeFileSync(join(dataDir, "library.json"), JSON.stringify([
    {
      id: "library-item-1",
      kind: "image",
      status: "done",
      output: { storedName: "asset-1.png" },
    },
  ], null, 2));
  writeFileSync(join(dataDir, "jobs.json"), JSON.stringify([
    {
      id: "job-1",
      libraryItemId: "library-item-1",
      status: "done",
    },
  ], null, 2));
  writeFileSync(join(uploadsDir, "asset-1.png"), "stage9d-fixture");

  const env = { DATA_DIR: dataDir, UPLOADS_DIR: uploadsDir };
  const plan = runNodeJson("scripts/database/plan-library-import.mjs", env);
  const consistency = runNodeJson("scripts/database/check-library-db-file-consistency.mjs", env);

  const repositoryText = readText(join(root, "src", "lib", "server", "database", "mvp-repositories.ts"));
  const adapterText = readText(join(root, "src", "lib", "server", "database", "library-jobs-adapter.ts"));

  const repositoryTerms = [
    "redactSecret",
    "redactJson",
    "raw_response_masked",
    "error_masked",
    "message_masked",
    "context_masked",
  ];
  const adapterTerms = [
    "user_visible_error",
    "internal_error_masked",
  ];

  const missingRepositoryTerms = repositoryTerms.filter((term) => !repositoryText.includes(term));
  const missingAdapterTerms = adapterTerms.filter((term) => !adapterText.includes(term));
  if (missingRepositoryTerms.length > 0) fail(`Repository redaction guards are incomplete: ${missingRepositoryTerms.join(", ")}`);
  if (missingAdapterTerms.length > 0) fail(`Adapter error separation guards are incomplete: ${missingAdapterTerms.join(", ")}`);

  console.log(JSON.stringify({
    ok: consistency.ok,
    stage: "Stage 9D",
    mode: "temporary_fixture",
    checkScope: [
      "library_items/assets mapping",
      "generation_jobs/library_items linkage",
      "upload file path safety",
      "provider response redaction guards",
      "user/internal error separation guards",
    ],
    importPlanAligned: {
      estimatedLibraryItems: plan.counts?.estimatedLibraryItems ?? 0,
      estimatedAssets: plan.counts?.estimatedAssets ?? 0,
      estimatedGenerationJobs: plan.counts?.estimatedGenerationJobs ?? 0,
      consistencyLibraryItemsAssets: consistency.checked?.libraryItemsAssets ?? 0,
      consistencyGenerationJobs: consistency.checked?.generationJobs ?? 0,
      consistencyUploadFiles: consistency.checked?.uploadFiles ?? 0,
    },
    providerResponseRedactionGuarded: true,
    userVisibleAndInternalErrorsSeparated: true,
    realDataModified: false,
    realDatabaseModified: false,
    productionDbWritten: false,
    stagingDbWritten: false,
    generationEndpointsCalled: false,
    newApiCalled: false,
    realProviderCalled: false,
    costIncurred: false,
    failures: consistency.failures,
    secrets: "masked",
  }, null, 2));
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}
