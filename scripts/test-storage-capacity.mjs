#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = process.cwd();
const outDir = join(root, "dist", "storage-capacity-tests");
const tempRoot = mkdtempSync(join(tmpdir(), "aohuang-storage-capacity-"));
const dataDir = join(tempRoot, "data");
const uploadsDir = join(tempRoot, "uploads");
const storageCheckScript = join(root, "scripts/ops/storage-check.mjs");
mkdirSync(dataDir, { recursive: true });
mkdirSync(uploadsDir, { recursive: true });

let status = 0;
try {
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
  const compile = spawnSync(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.storage-capacity-tests.json"], {
    cwd: root,
    stdio: "inherit",
    shell: false,
  });
  if (compile.status !== 0) {
    status = compile.status ?? 1;
  } else {
    const testFile = [
      "dist/storage-capacity-tests/src/lib/server/__tests__/storage-capacity.test.js",
      "dist/storage-capacity-tests/server/__tests__/storage-capacity.test.js",
    ].find((candidate) => existsSync(join(root, candidate)));
    assert(testFile, "compiled storage capacity test file must exist");
    const run = spawnSync(process.execPath, ["--conditions=react-server", "--test", testFile], {
      cwd: root,
      env: isolatedEnv(),
      stdio: "inherit",
      shell: false,
    });
    status = run.status ?? 1;
  }

  if (status === 0) {
    const ops = spawnSync(process.execPath, ["--conditions=react-server", storageCheckScript, "--json"], {
      cwd: root,
      env: isolatedEnv(),
      encoding: "utf8",
      shell: false,
    });
    assert.equal(ops.status, 0, outputMessage(ops));
    const output = JSON.parse(ops.stdout);
    assert.equal(typeof output.level, "string");
    assert.equal(Array.isArray(output.roots), true);
    assert(output.roots.some((item) => item.label === "DATA_DIR"));
    assert(output.roots.some((item) => item.label === "UPLOADS_DIR"));
    assert.equal(typeof output.roots[0].totalBytes, "number");
    assertSanitizedOutput(ops.stdout + ops.stderr);
  }

  const sources = {
    library: read("src/lib/server/library.ts"),
    remoteMediaDownload: read("src/lib/server/remote-media-download.ts"),
    providerCall: read("src/lib/server/provider-call.ts"),
    volcengineUpscale: read("src/lib/server/volcengine-upscale.ts"),
    health: read("src/lib/server/security/health.ts"),
    packageJson: read("package.json"),
  };
  assert(sources.packageJson.includes("\"ops:storage:check\""), "package scripts must expose ops:storage:check");
  assertSequence("storeRemoteUrl delegates to streamed remote media storage", sources.library, [
    "storeRemoteUrlStreamed(url, { prefix, fallbackMime })",
  ]);
  assertSequence("streamed remote media checks storage before writing", sources.remoteMediaDownload, [
    "assertContentLengthAllowed(response.headers.get(\"content-length\"), kind)",
    "await assertStorageAllows(kind === \"video\" ? \"video-media-write\" : \"image-media-write\", { fresh: true })",
    "writeRemoteResponseToUploads(response, mimeType, kind, options.prefix)",
  ]);
  assertSequence("video generation upload capacity before Buffer allocation", sources.providerCall, [
    "await assertStorageAllows(\"video-upload\", { fresh: true })",
    "assertFileSizeAllowed(file, \"reference-image\")",
    "Buffer.from(await file.arrayBuffer())",
  ]);
  assertSequence("video upscale upload capacity before Buffer allocation", sources.volcengineUpscale, [
    "assertFileSizeAllowed(value, uploadKind)",
    "await assertStorageAllows(\"video-upload\", { fresh: true })",
    "await assertFileFormatAllowed(value, uploadKind)",
    "Buffer.from(await value.arrayBuffer())",
  ]);
  assert(sources.health.includes("storageStatusForPublicHealth"), "backend health must include sanitized storage status");
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

if (status !== 0) process.exit(status);

console.log(JSON.stringify({
  ok: true,
  thresholdsCovered: [69, 70, 80, 85, 90, 95],
  statsInjectable: true,
  differentFilesystemsStrictest: true,
  statFailureConservative: true,
  readAndCleanupAllowedAtEmergency: true,
  publicPathsRedacted: true,
  realRuntimeAccessed: false,
}, null, 2));

function isolatedEnv() {
  return {
    ...process.env,
    PORT: "3107",
    AOHUANG_ALLOW_RUNTIME_DIR_OVERRIDE: "1",
    RUNTIME_STORAGE_ISOLATION: "strict",
    DATA_DIR: dataDir,
    UPLOADS_DIR: uploadsDir,
    APP_AUTH_PERSISTENCE_MODE: "json",
    LIBRARY_STORAGE_BACKEND: "json",
    GENERATION_JOBS_BACKEND: "existing",
  };
}

function read(file) {
  return readFileSync(join(root, file), "utf8");
}

function assertSequence(name, source, tokens) {
  let cursor = -1;
  for (const token of tokens) {
    const index = source.indexOf(token, cursor + 1);
    assert(index > cursor, `${name} missing or reordered token: ${token}`);
    cursor = index;
  }
}

function assertSanitizedOutput(outputText) {
  assert(!outputText.includes(resolve(dataDir)), "output must not include absolute DATA_DIR");
  assert(!outputText.includes(resolve(uploadsDir)), "output must not include absolute UPLOADS_DIR");
  assert(!/(token|password|secret|api[_-]?key)=/i.test(outputText), "output must not print secrets");
}

function outputMessage(result) {
  return `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`;
}
