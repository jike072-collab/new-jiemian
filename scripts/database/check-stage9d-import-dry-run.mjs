#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const fixtureRoot = mkdtempSync(join(tmpdir(), "aohuang-stage9d-import-"));

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

  const plan = runNodeJson("scripts/database/plan-library-import.mjs", {
    DATA_DIR: dataDir,
    UPLOADS_DIR: uploadsDir,
  });

  console.log(JSON.stringify({
    ok: plan.ok,
    stage: "Stage 9D",
    mode: "dry-run-rehearsal",
    dryRunOnly: true,
    realImportExecuted: false,
    productionDataChanged: false,
    productionUploadsChanged: false,
    stagingDataChanged: false,
    stagingUploadsChanged: false,
    databaseWritten: false,
    dataUploadsModified: false,
    scanSource: "temporary_fixture",
    mappingPlan: {
      jsonToTables: [
        "data/library.json -> library_items/assets",
        "data/jobs.json -> generation_jobs",
      ],
      uploadsToAssets: true,
      importOrder: plan.suggestedImportOrder,
    },
    estimatedLibraryItems: plan.counts?.estimatedLibraryItems ?? 0,
    estimatedAssets: plan.counts?.estimatedAssets ?? 0,
    estimatedGenerationJobs: plan.counts?.estimatedGenerationJobs ?? 0,
    unmappableRecords: (plan.counts?.missingFiles ?? 0) + (plan.counts?.conflictRecords ?? 0),
    riskLevel: plan.riskLevel,
    generationEndpointsCalled: false,
    newApiCalled: false,
    realProviderCalled: false,
    costIncurred: false,
    secrets: "masked",
  }, null, 2));
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}
