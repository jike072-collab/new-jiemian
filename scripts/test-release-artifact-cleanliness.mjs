#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  assertReleaseArtifactClean,
  buildReleaseCandidateVerificationEnv,
  createReleaseCandidateRoot,
  createReleaseValidationWorktreeRoot,
  shouldExcludeFromReleaseArtifact,
} from "./ops/deploy-service.mjs";
import { getServiceConfig } from "./ops/service-config.mjs";

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

async function withTempProject(fn) {
  const root = await mkdtemp(join(tmpdir(), "aohuang release artifact 中文 path "));
  try {
    mkdirSync(join(root, ".runtime"), { recursive: true });
    mkdirSync(join(root, "data"), { recursive: true });
    mkdirSync(join(root, "uploads"), { recursive: true });
    await writeFile(join(root, "package.json"), "{}");
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function seedCodeArtifact(root) {
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, ".next", "server"), { recursive: true });
  mkdirSync(join(root, ".next", "static"), { recursive: true });
  mkdirSync(join(root, "node_modules", "next", "dist", "bin"), { recursive: true });
  writeFileSync(join(root, "src", "index.ts"), "export const ok = true;\n");
  writeFileSync(join(root, ".next", "BUILD_ID"), "build");
  writeFileSync(join(root, ".next", "required-server-files.json"), "{}");
  writeFileSync(join(root, ".next", "server", "index.js"), "module.exports = {};\n");
  writeFileSync(join(root, ".next", "static", "asset.js"), "console.log('ok');\n");
  writeFileSync(join(root, "node_modules", "next", "dist", "bin", "next"), "next");
}

function assertRejectsArtifact(root, relativePath, pattern) {
  const target = join(root, relativePath);
  mkdirSync(relativePath.endsWith("/") ? target : join(target, ".."), { recursive: true });
  if (!relativePath.endsWith("/")) writeFileSync(target, "runtime");
  assert.throws(() => assertReleaseArtifactClean(root), pattern);
}

test("release artifact allows code, build output, and node_modules only", async () => {
  await withTempProject(async (root) => {
    const releaseDir = join(root, ".runtime", "releases", "clean artifact");
    seedCodeArtifact(releaseDir);
    assert.doesNotThrow(() => assertReleaseArtifactClean(releaseDir));
  });
});

test("release artifact and validation worktree roots are separated", async () => {
  await withTempProject(async (root) => {
    const config = getServiceConfig("production", { root });
    const releaseDir = createReleaseCandidateRoot(config, "abcdef1234567890", "deploy-id");
    const validationDir = createReleaseValidationWorktreeRoot(config, "abcdef1234567890", "deploy-id");
    assert(releaseDir.includes(join(".runtime", "releases")));
    assert(validationDir.includes(join(".runtime", "release-worktrees")));
    assert.notEqual(releaseDir, validationDir);
  });
});

test("release artifact rejects runtime data directories and files", async () => {
  const cases = [
    ["data/", /data/],
    ["uploads/", /uploads/],
    [".runtime/", /\.runtime/],
    ["artifacts/", /artifacts/],
    ["data-staging/", /data-staging/],
    ["dist/", /dist/],
    ["uploads-staging/", /uploads-staging/],
    ["_rollback_backups/", /_rollback_backups/],
    ["logs/", /logs/],
    [".env.production", /\.env\.production/],
    [".env.local", /\.env\.local/],
    ["service.pid", /\.pid/],
    ["runtime.log", /\.log/],
    ["database.dump", /\.dump/],
    ["local.sqlite", /\.sqlite/],
    ["local.sqlite3", /\.sqlite3/],
    ["local.db", /\.db/],
  ];

  for (const [path, pattern] of cases) {
    await withTempProject(async (root) => {
      const releaseDir = join(root, ".runtime", "releases", `dirty-${path.replace(/[\\/.*]/g, "-")}`);
      seedCodeArtifact(releaseDir);
      assertRejectsArtifact(releaseDir, path, pattern);
    });
  }
});

test("copy filter excludes runtime state from contaminated validation roots", async () => {
  await withTempProject(async (root) => {
    const validationDir = join(root, ".runtime", "release-worktrees", "dirty validation");
    const releaseDir = join(root, ".runtime", "releases", "filtered artifact");
    seedCodeArtifact(validationDir);
    mkdirSync(join(validationDir, "data"), { recursive: true });
    mkdirSync(join(validationDir, "uploads"), { recursive: true });
    mkdirSync(join(validationDir, ".runtime"), { recursive: true });
    writeFileSync(join(validationDir, "data", "library.json"), "[]");
    writeFileSync(join(validationDir, "uploads", "asset.txt"), "upload");
    writeFileSync(join(validationDir, ".env.local"), "SECRET=masked");
    writeFileSync(join(validationDir, "trace.log"), "log");

    const { cpSync } = await import("node:fs");
    cpSync(validationDir, releaseDir, {
      recursive: true,
      force: true,
      filter: (source) => !shouldExcludeFromReleaseArtifact(source, { artifactRoot: validationDir }),
    });

    assert.equal(existsSync(join(releaseDir, "src", "index.ts")), true);
    assert.equal(existsSync(join(releaseDir, "data")), false);
    assert.equal(existsSync(join(releaseDir, "uploads")), false);
    assert.equal(existsSync(join(releaseDir, ".runtime")), false);
    assert.equal(existsSync(join(releaseDir, ".env.local")), false);
    assert.equal(existsSync(join(releaseDir, "trace.log")), false);
    assert.doesNotThrow(() => assertReleaseArtifactClean(releaseDir));
  });
});

test("release artifact checks nested runtime state but ignores package internals", async () => {
  await withTempProject(async (root) => {
    const releaseDir = join(root, ".runtime", "releases", "nested");
    seedCodeArtifact(releaseDir);
    mkdirSync(join(releaseDir, "docs", "data"), { recursive: true });
    writeFileSync(join(releaseDir, "docs", "data", "runtime.json"), "{}");
    assert.throws(() => assertReleaseArtifactClean(releaseDir), /docs.*data|data/);

    const packageDir = join(releaseDir, "node_modules", "fixture-package", "data");
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(join(packageDir, "fixture.db"), "package fixture");
    await rm(join(releaseDir, "docs"), { recursive: true, force: true });
    assert.doesNotThrow(() => assertReleaseArtifactClean(releaseDir));
  });
});

test("candidate verification data and uploads are outside release artifact", async () => {
  await withTempProject(async (root) => {
    const config = getServiceConfig("production", { root });
    const releaseDir = createReleaseCandidateRoot(config, "abcdef1234567890", "deploy-id");
    const scratchRoot = join(config.runtimeDir, "release-smoke", "abcdef123456-deploy-id");
    const env = buildReleaseCandidateVerificationEnv({
      PORT: "3106",
      DATA_DIR: "data",
      UPLOADS_DIR: "uploads",
      APP_DATABASE_URL: "postgresql://user:pass@127.0.0.1:5432/prod_db",
    }, scratchRoot, { includeRuntimeConfig: true });

    assert.equal(env.DATA_DIR, join(scratchRoot, "data"));
    assert.equal(env.UPLOADS_DIR, join(scratchRoot, "uploads"));
    assert.equal(resolve(env.DATA_DIR).startsWith(resolve(releaseDir)), false);
    assert.equal(resolve(env.UPLOADS_DIR).startsWith(resolve(releaseDir)), false);
  });
});

test("non-runtime validation checks do not inherit scratch data overrides", async () => {
  await withTempProject(async (root) => {
    const config = getServiceConfig("production", { root });
    const scratchRoot = join(config.runtimeDir, "release-smoke", "abcdef123456-deploy-id");
    const env = buildReleaseCandidateVerificationEnv({
      DATA_DIR: "process-data",
      UPLOADS_DIR: "process-uploads",
      AOHUANG_ALLOW_RUNTIME_DIR_OVERRIDE: "1",
      RUNTIME_STORAGE_ISOLATION: "strict",
    }, scratchRoot, { includeRuntimeConfig: false });

    assert.equal(env.DATA_DIR, undefined);
    assert.equal(env.UPLOADS_DIR, undefined);
    assert.equal(env.AOHUANG_ALLOW_RUNTIME_DIR_OVERRIDE, undefined);
    assert.equal(env.RUNTIME_STORAGE_ISOLATION, undefined);
  });
});

test("cleanup targets candidate scratch only and preserves official runtime data", async () => {
  await withTempProject(async (root) => {
    const config = getServiceConfig("production", { root });
    writeFileSync(join(config.dataDir, "library.json"), "[]");
    writeFileSync(join(config.uploadsDir, "asset.txt"), "upload");
    const scratchRoot = join(config.runtimeDir, "release-smoke", "candidate");
    mkdirSync(join(scratchRoot, "data"), { recursive: true });
    mkdirSync(join(scratchRoot, "uploads"), { recursive: true });
    await rm(scratchRoot, { recursive: true, force: true });
    assert.equal(existsSync(join(config.dataDir, "library.json")), true);
    assert.equal(existsSync(join(config.uploadsDir, "asset.txt")), true);
  });
});

test("release exclusion helper is stable for Windows-style paths", async () => {
  await withTempProject(async (root) => {
    const releaseDir = join(root, ".runtime", "releases", "win path");
    const dataPath = join(releaseDir, "data", "library.json");
    const envPath = join(releaseDir, ".env.local");
    const codePath = join(releaseDir, "src", "data-model.ts");
    assert.equal(shouldExcludeFromReleaseArtifact(dataPath, { artifactRoot: releaseDir }), true);
    assert.equal(shouldExcludeFromReleaseArtifact(envPath, { artifactRoot: releaseDir }), true);
    assert.equal(shouldExcludeFromReleaseArtifact(codePath, { artifactRoot: releaseDir }), false);
  });
});

for (const { name, fn } of tests) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error instanceof Error ? error.stack || error.message : String(error));
  }
}

console.log(`release artifact cleanliness tests: total=${tests.length} passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
