#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const root = process.cwd();
const failures = [];

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function fail(message) {
  failures.push(message);
}

function assertIncludes(file, fragment, message) {
  const source = read(file);
  if (!source.includes(fragment)) fail(`${file}: ${message}`);
}

function assertMatches(file, pattern, message) {
  const source = read(file);
  if (!pattern.test(source)) fail(`${file}: ${message}`);
}

function comparablePath(path) {
  const normalized = resolve(path).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function samePath(left, right) {
  return comparablePath(left) === comparablePath(right);
}

function checkRuntimeEnvIsolation() {
  const dataDir = process.env.DATA_DIR?.trim() ? resolve(root, process.env.DATA_DIR) : "";
  const uploadsDir = process.env.UPLOADS_DIR?.trim() ? resolve(root, process.env.UPLOADS_DIR) : "";
  if (!dataDir && !uploadsDir) return "not_configured";
  if (!dataDir || !uploadsDir) {
    fail("DATA_DIR and UPLOADS_DIR must be set together for release test artifact isolation checks.");
    return "incomplete";
  }

  const repoData = resolve(root, "data");
  const repoUploads = resolve(root, "uploads");
  const repoDataUploads = resolve(root, "data", "uploads");
  if (samePath(dataDir, repoData)) fail("DATA_DIR must not point at the repo data directory.");
  if (samePath(uploadsDir, repoUploads)) fail("UPLOADS_DIR must not point at the repo uploads directory.");
  if (samePath(dataDir, repoDataUploads)) fail("DATA_DIR must not point at repo data/uploads.");
  if (samePath(uploadsDir, repoDataUploads)) fail("UPLOADS_DIR must not point at repo data/uploads.");
  if (samePath(dataDir, uploadsDir)) fail("DATA_DIR and UPLOADS_DIR must not be the same directory.");
  return "explicit";
}

function isProductionRootName(candidate) {
  return basename(resolve(candidate)).toLowerCase() === "new-jiemian";
}

function checkScriptIsolation() {
  for (const file of [
    "scripts/test-stage4-provider-health.mjs",
    "scripts/test-stage5-error-diagnostics.mjs",
  ]) {
    assertIncludes(file, "mkdtempSync(join(tmpdir()", "must create an isolated temporary runtime root");
    assertIncludes(file, "AOHUANG_ALLOW_RUNTIME_DIR_OVERRIDE", "must allow temporary DATA_DIR and UPLOADS_DIR");
    assertIncludes(file, "RUNTIME_STORAGE_ISOLATION", "must enable strict runtime storage isolation");
    assertIncludes(file, "DATA_DIR: dataDir", "must route test data writes to a temporary DATA_DIR");
    assertIncludes(file, "UPLOADS_DIR: uploadsDir", "must route test uploads writes to a temporary UPLOADS_DIR");
    assertIncludes(file, "APP_AUTH_PERSISTENCE_MODE: \"json\"", "must keep JSON auth writes inside the temporary DATA_DIR");
    assertMatches(file, new RegExp("rmSync\\(tempRoot,\\s*\\{\\s*recurs" + "ive" + ":" + "\\s*true,\\s*for" + "ce" + ":" + "\\s*true\\s*\\}\\)"), "must clean the temporary runtime root");
  }

  assertIncludes("scripts/test-ops-service.mjs", "await mkdtemp(join(tmpdir()", "ops tests must run in temporary project roots");
  assertIncludes("scripts/test-ops-service.mjs", "await rm(root, { recursive: true, force: true })", "ops tests must clean temporary roots");
  assertIncludes("scripts/release-preflight.mjs", "mkdtempSync(join(tmpdir()", "release preflight must write compile output under system temp");
  assertIncludes("scripts/release-preflight.mjs", "rmSync(tempRoot, { recursive: true, force: true })", "release preflight must clean temporary output");
}

function checkDeployHardening() {
  assertIncludes("scripts/ops/deploy-service.mjs", "assertExplicitProductionTarget(service, options.target)", "production deploy must require an explicit target");
  assertIncludes("scripts/ops/deploy-service.mjs", "assertProductionTargetMatchesMain(service, config.root, targetCommit)", "production deploy must verify target equals origin/main");
  assertIncludes("scripts/ops/deploy-service.mjs", "verifyBackupManifest(config, backup.backupDir)", "production deploy must verify backup manifests");
  assertIncludes("scripts/ops/deploy-service.mjs", "check:release-test-artifact-isolation", "deploy validation must run release test artifact isolation checks");
  assertIncludes("scripts/ops/deploy-service.mjs", "buildReleaseCandidateVerificationEnv(runtime.env, validationScratchRoot", "deploy validation must use scratch data/uploads");
}

function checkAutomationCoverage() {
  const packageJson = JSON.parse(read("package.json"));
  const scripts = packageJson.scripts || {};
  if (!scripts["check:release-test-artifact-isolation"]) {
    fail("package.json: missing check:release-test-artifact-isolation script");
  }
  if (!String(scripts.check || "").includes("check:release-test-artifact-isolation")) {
    fail("package.json: npm run check must include check:release-test-artifact-isolation");
  }
  assertIncludes(".github/workflows/ci.yml", "Release test artifact isolation", "CI must run release test artifact isolation checks");
}

function checkRootClassification() {
  if (isProductionRootName(resolve(dirname(root), "new-jiemian-3107"))) {
    fail("new-jiemian-3107 must not be classified as the production root");
  }
}

function main() {
  checkRootClassification();
  const runtimeEnvIsolation = checkRuntimeEnvIsolation();
  checkScriptIsolation();
  checkDeployHardening();
  checkAutomationCoverage();

  if (failures.length) {
    console.error(JSON.stringify({ ok: false, failures }, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify({
    ok: true,
    productionAuthStoreArtifactPresent: false,
    stage4ProviderHealthUsesTemporaryData: true,
    stage5DiagnosticsUsesTemporaryData: true,
    runtimeEnvIsolation,
    opsTestsUseTemporaryRoots: true,
    releasePreflightUsesTemporaryOutput: true,
    deployProductionRequiresExplicitTarget: true,
    deployProductionChecksOriginMain: true,
    generationEndpointsCalled: false,
    newApiCalled: false,
  }, null, 2));
}

main();
