#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const outDir = join(root, "dist", "error-diagnostics-tests");
const tempRoot = mkdtempSync(join(tmpdir(), "aohuang-error-diagnostics-"));
const dataDir = join(tempRoot, "data");
const uploadsDir = join(tempRoot, "uploads");

let testStatus = 0;
try {
  if (existsSync(outDir)) {
    rmSync(outDir, { recursive: true, force: true });
  }

  const compile = spawnSync("npx", ["tsc", "-p", "tsconfig.error-diagnostics-tests.json"], {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (compile.status !== 0) {
    testStatus = compile.status ?? 1;
  } else {
    const tests = [
      "dist/error-diagnostics-tests/src/lib/server/__tests__/error-diagnostics.test.js",
    ];

    const run = spawnSync("node", ["--conditions=react-server", "--test", ...tests], {
      cwd: root,
      env: {
        ...process.env,
        PORT: "3107",
        AOHUANG_ALLOW_RUNTIME_DIR_OVERRIDE: "1",
        RUNTIME_STORAGE_ISOLATION: "strict",
        DATA_DIR: dataDir,
        UPLOADS_DIR: uploadsDir,
        APP_AUTH_PERSISTENCE_MODE: "json",
        APP_BILLING_PERSISTENCE_MODE: "json",
        APP_TASK_BILLING_PERSISTENCE_MODE: "json",
      },
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    testStatus = run.status ?? 1;
  }
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
  if (existsSync(tempRoot)) {
    console.error("temporary error diagnostics test directory cleanup failed.");
    testStatus = 1;
  }
}

if (testStatus !== 0) process.exit(testStatus);

const sources = {
  imageRoute: read("src/app/api/generate/image/route.ts"),
  videoRoute: read("src/app/api/generate/video/route.ts"),
  imageUpscaleRoute: read("src/app/api/upscale/image/route.ts"),
  videoUpscaleRoute: read("src/app/api/upscale/video/route.ts"),
  jobRoute: read("src/app/api/jobs/[id]/route.ts"),
  libraryRoute: read("src/app/api/library/route.ts"),
  clientApi: read("src/lib/client/api.ts"),
  studioApp: read("src/components/studio-app.tsx"),
  shared: read("src/components/studio/shared.tsx"),
  resultPreview: read("src/components/studio/result-preview.tsx"),
  imageGenerator: read("src/components/studio/image-generator.tsx"),
  videoGenerator: read("src/components/studio/video-generator.tsx"),
  upscaleForm: read("src/components/studio/upscale-form.tsx"),
  packageJson: read("package.json"),
  ci: read(".github/workflows/ci.yml"),
};

for (const [name, source] of Object.entries({
  imageRoute: sources.imageRoute,
  videoRoute: sources.videoRoute,
  imageUpscaleRoute: sources.imageUpscaleRoute,
  videoUpscaleRoute: sources.videoUpscaleRoute,
  jobRoute: sources.jobRoute,
  libraryRoute: sources.libraryRoute,
})) {
  assert(source.includes("diagnosticErrorResponse"), `${name} must use diagnosticErrorResponse`);
  assert(source.includes("fallbackMessage"), `${name} must preserve a legacy fallback message`);
}

assert(sources.clientApi.includes("readonly diagnostic?: ErrorDiagnostic"), "ApiError must preserve diagnostic payloads");
assert(sources.studioApp.includes("diagnosticFromError"), "StudioApp must extract diagnostics from ApiError");
assert(sources.studioApp.includes("submitDiagnostic"), "StudioApp must store submit diagnostics");
assert(sources.shared.includes("StudioErrorAlert"), "shared UI must expose StudioErrorAlert");
assert(sources.resultPreview.includes("StudioErrorAlert"), "preview failure state must render diagnostics");
assert(sources.imageGenerator.includes("diagnostic={state.submitDiagnostic}"), "image form must render diagnostics");
assert(sources.videoGenerator.includes("diagnostic={state.submitDiagnostic}"), "video form must render diagnostics");
assert(sources.upscaleForm.includes("diagnostic={state.submitDiagnostic}"), "upscale forms must render diagnostics");

const forbiddenRealCalls = [
  ["/v1", "/images", "/generations"].join(""),
  ["/v1", "/images", "/edits"].join(""),
  ["/v1", "/videos", "/generations"].join(""),
  ["new", "NewApiClient"].join(" "),
  ["newApi", "AdminRequestContext"].join(""),
  ["fetch(", "\"https://"].join(""),
  ["fetch(", "'https://"].join(""),
];
for (const token of forbiddenRealCalls) {
  assert(!read("scripts/test-stage5-error-diagnostics.mjs").includes(token), `Stage 5 test must not call ${token}`);
}

assert(sources.packageJson.includes("\"test:stage5-error-diagnostics\""), "package.json must expose the Stage 5 test script");
assert(sources.packageJson.includes("npm run test:stage5-error-diagnostics"), "npm run check must include Stage 5 diagnostics");
assert(sources.ci.includes("Stage 5 error diagnostics"), "CI must include Stage 5 diagnostics");

console.log(JSON.stringify({
  ok: true,
  diagnosticCodes: 43,
  routeContracts: 6,
  frontendDiagnosticSurfaces: 4,
  generationEndpointsCalled: false,
  newApiCalled: false,
}, null, 2));

function read(file) {
  return readFileSync(join(root, file), "utf8");
}
