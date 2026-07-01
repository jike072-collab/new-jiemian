#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { mkdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";

const root = process.cwd();
const script = join(root, "scripts/ops/cleanup-expired-media.mjs");
const tempRoot = mkdtempSync(join(tmpdir(), "aohuang-media-retention-"));
const dataDir = join(tempRoot, "runtime-data");
const uploadsDir = join(tempRoot, "runtime-uploads");
const outsideDir = join(tempRoot, "outside");
let symlinkCreated = false;

try {
  await mkdir(dataDir, { recursive: true });
  await mkdir(uploadsDir, { recursive: true });
  await mkdir(outsideDir, { recursive: true });

  writeFileSync(join(uploadsDir, "expired-video.mp4"), "expired-video");
  writeFileSync(join(uploadsDir, "json-fail.mp4"), "json-fail");
  writeFileSync(join(uploadsDir, "db-fail.mp4"), "db-fail");
  writeFileSync(join(uploadsDir, "pending-retry.mp4"), "pending-retry");
  writeFileSync(join(uploadsDir, "fresh-image.png"), "fresh-image");
  writeFileSync(join(uploadsDir, "generating-video.mp4"), "generating-video");
  writeFileSync(join(outsideDir, "outside.mp4"), "outside");
  try {
    symlinkSync(join(outsideDir, "outside.mp4"), join(uploadsDir, "linked.mp4"));
    symlinkCreated = true;
  } catch {
    symlinkCreated = false;
  }

  writeFileSync(join(dataDir, "library.json"), JSON.stringify([
    libraryItem("expired-video", {
      type: "video",
      completedAt: hoursAgo(24.1),
      output: output("expired-video.mp4", "video/mp4", 13),
    }),
    libraryItem("fresh-image", {
      type: "image",
      completedAt: hoursAgo(23.9),
      output: output("fresh-image.png", "image/png", 11),
    }),
    libraryItem("json-fail", {
      type: "video",
      completedAt: hoursAgo(24.2),
      output: output("json-fail.mp4", "video/mp4", 9),
    }),
    libraryItem("db-fail", {
      type: "video",
      completedAt: hoursAgo(24.2),
      output: output("db-fail.mp4", "video/mp4", 7),
    }),
    libraryItem("pending-retry", {
      type: "video",
      completedAt: hoursAgo(24.2),
      output: undefined,
      expirationPending: true,
      expirationPendingAt: hoursAgo(24.1),
      expirationPendingStoredName: "pending-retry.mp4",
    }),
    libraryItem("generating-video", {
      type: "video",
      status: "generating",
      completedAt: undefined,
      output: output("generating-video.mp4", "video/mp4", 16),
    }),
    libraryItem("external-url", {
      type: "image",
      completedAt: hoursAgo(25),
      output: {
        url: "https://cdn.example.invalid/result.png",
        mimeType: "image/png",
        sourceUrl: "https://cdn.example.invalid/result.png",
        size: 9,
      },
    }),
    libraryItem("missing-file", {
      type: "image",
      output: output("missing.png", "image/png", 7),
    }),
    libraryItem("path-escape", {
      type: "video",
      completedAt: hoursAgo(26),
      output: output("../escape.mp4", "video/mp4", 8),
    }),
    ...(symlinkCreated ? [
      libraryItem("symlink-escape", {
        type: "video",
        completedAt: hoursAgo(26),
        output: output("linked.mp4", "video/mp4", 8),
      }),
    ] : []),
  ], null, 2));
  writeFileSync(join(dataDir, "jobs.json"), JSON.stringify([
    {
      id: "job-generating",
      libraryItemId: "generating-video",
      type: "video",
      providerId: "provider",
      status: "generating",
      statusUrl: "https://provider.example.invalid/status",
      createdAt: "2026-06-29T00:00:00.000Z",
      updatedAt: "2026-06-29T00:00:00.000Z",
    },
  ], null, 2));

  const defaultDryRun = runCleanup([]);
  assert.equal(defaultDryRun.status, 0, outputMessage(defaultDryRun));
  const defaultDryRunOutput = parseJson(defaultDryRun.stdout);
  assert.equal(defaultDryRunOutput.mode, "dry-run");
  assert.equal(defaultDryRunOutput.deletedFiles, 0);

  const dryRun = runCleanup(["--dry-run"]);
  assert.equal(dryRun.status, 0, outputMessage(dryRun));
  const dryRunOutput = parseJson(dryRun.stdout);
  assert.equal(dryRunOutput.mode, "dry-run");
  assert(dryRunOutput.candidates >= 3, "dry-run should find expired local media candidates");
  assert.equal(dryRunOutput.deletedFiles, 0);
  assert.equal(dryRunOutput.expiredItems, 0);
  assert(dryRunOutput.items.some((item) => item.id === "expired-video" && item.relativePath === "UPLOADS_DIR:expired-video.mp4"));
  assert(dryRunOutput.items.some((item) => item.id === "missing-file" && item.relativePath === "UPLOADS_DIR:missing.png"));
  assert(dryRunOutput.skippedItems.some((item) => item.id === "path-escape" && item.reason === "invalid_stored_name"));
  if (symlinkCreated) {
    assert(dryRunOutput.skippedItems.some((item) => item.id === "symlink-escape" && item.reason === "symlink_refused"));
  }
  assertSanitizedOutput(dryRun.stdout + dryRun.stderr);
  assert.equal(existsSync(join(uploadsDir, "expired-video.mp4")), true, "dry-run must not delete expired media");

  const jsonFailure = runCleanup(["--apply", "--confirm-apply"], { AOHUANG_TEST_FAIL_LIBRARY_UPDATE_ID: "json-fail" });
  assert.notEqual(jsonFailure.status, 0, "JSON update failure must fail cleanup");
  const jsonFailureOutput = parseJson(jsonFailure.stdout);
  assert.equal(existsSync(join(uploadsDir, "json-fail.mp4")), true, "JSON failure must restore file to original location");
  assertActivePointsToExistingFile(readLibrary(), uploadsDir);
  assertNoQuarantineFiles(uploadsDir, "json-fail");
  assertExpired(readLibrary(), "expired-video");
  markUnexpired("json-fail");

  const dbFailure = runCleanup(["--apply", "--confirm-apply"], {
    LIBRARY_STORAGE_BACKEND: "database",
    DATABASE_LIBRARY_DUAL_WRITE: "true",
    AOHUANG_TEST_FAIL_EXPIRATION_PENDING_DATABASE: "db-fail",
  });
  assert.notEqual(dbFailure.status, 0, "database failure must fail cleanup");
  assert.equal(existsSync(join(uploadsDir, "db-fail.mp4")), true, "database failure must restore file to original location");
  assertActivePointsToExistingFile(readLibrary(), uploadsDir);
  assertNoQuarantineFiles(uploadsDir, "db-fail");
  markUnexpired("db-fail");

  const pendingOriginal = join(uploadsDir, "pending-retry.mp4");
  const quarantineDir = join(uploadsDir, ".retention-quarantine");
  await mkdir(quarantineDir, { recursive: true });
  const pendingQuarantine = join(quarantineDir, `pending-retry-${Date.now()}-pending-retry.mp4`);
  renameSync(pendingOriginal, pendingQuarantine);

  const missingConfirm = runCleanup(["--apply"]);
  assert.notEqual(missingConfirm.status, 0, "apply without confirmation must fail");
  assert.match(missingConfirm.stderr, /apply_requires_confirmation/);

  const apply = runCleanup(["--apply", "--confirm-apply"]);
  assert.equal(apply.status, 0, outputMessage(apply));
  const applyOutput = parseJson(apply.stdout);
  assert.equal(applyOutput.mode, "apply");
  assert.equal(
    jsonFailureOutput.deletedFiles + applyOutput.deletedFiles,
    2,
    "expired existing and pending retry files should be deleted across failed and resumed cleanup runs",
  );
  assert.equal(
    jsonFailureOutput.expiredItems + applyOutput.expiredItems,
    3,
    "expired existing, pending retry, and missing files should converge to expired records across cleanup runs",
  );
  assert.equal(existsSync(join(uploadsDir, "expired-video.mp4")), false);
  assert.equal(existsSync(join(uploadsDir, "fresh-image.png")), true);
  assert.equal(existsSync(join(uploadsDir, "generating-video.mp4")), true);
  assert.equal(existsSync(join(outsideDir, "outside.mp4")), true);
  assertSanitizedOutput(apply.stdout + apply.stderr);

  const afterApply = readLibrary();
  assertExpired(afterApply, "expired-video");
  assertExpired(afterApply, "missing-file");
  assertExpired(afterApply, "pending-retry");
  assertStillAvailable(afterApply, "fresh-image", "fresh-image.png");
  assertStillAvailable(afterApply, "generating-video", "generating-video.mp4");
  assert.equal(afterApply.find((item) => item.id === "external-url")?.output?.url, "https://cdn.example.invalid/result.png");
  assert.equal(afterApply.find((item) => item.id === "path-escape")?.expired, undefined);
  if (symlinkCreated) assert.equal(afterApply.find((item) => item.id === "symlink-escape")?.expired, undefined);

  const repeat = runCleanup(["--apply", "--confirm-apply"]);
  assert.equal(repeat.status, 0, outputMessage(repeat));
  const repeatOutput = parseJson(repeat.stdout);
  assert.equal(repeatOutput.deletedFiles, 0, "repeated apply must not delete more files");
  assert.equal(repeatOutput.expiredItems, 0, "repeated apply must be idempotent for expired records");
  assertSanitizedOutput(repeat.stdout + repeat.stderr);

  const invalidRetention = runCleanup(["--dry-run"], { MEDIA_RETENTION_HOURS: "999" });
  assert.equal(invalidRetention.status, 0, outputMessage(invalidRetention));
  const invalidRetentionOutput = parseJson(invalidRetention.stdout);
  assert.equal(invalidRetentionOutput.retentionHours, 24, "invalid retention config must fall back to the safe default");

  console.log(JSON.stringify({
    ok: true,
    dryRunDefault: true,
    expiredMediaDeleted: true,
    missingFileConverged: true,
    unexpiredPreserved: true,
    generatingPreserved: true,
    externalUrlPreserved: true,
    pathEscapeRefused: true,
    symlinkEscapeRefused: symlinkCreated,
    repeatedApplySafe: true,
    jsonFailureRestored: true,
    databaseFailureRestored: true,
    pendingRetryConverged: true,
    invalidRetentionDefaulted: true,
    realRuntimeAccessed: false,
  }, null, 2));
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

function libraryItem(id, overrides = {}) {
  const createdAt = overrides.createdAt || hoursAgo(26);
  return {
    id,
    ownerLocalUserId: "11111111-1111-4111-8111-111111111111",
    type: overrides.type || "image",
    mode: overrides.type === "video" ? "text-to-video" : "text-to-image",
    title: `title-${id}`,
    prompt: `secret prompt ${id}`,
    providerId: "provider",
    model: "model",
    status: overrides.status || "done",
    createdAt,
    updatedAt: overrides.updatedAt || createdAt,
    ...(overrides.completedAt === undefined ? {} : { completedAt: overrides.completedAt }),
    output: overrides.output,
    ...overrides,
    params: {},
  };
}

function hoursAgo(hours) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function output(storedName, mimeType, size) {
  return {
    url: `/api/files/${encodeURIComponent(storedName)}`,
    storedName,
    mimeType,
    size,
  };
}

function runCleanup(args, envOverrides = {}) {
  return spawnSync(process.execPath, ["--conditions=react-server", script, ...args], {
    cwd: root,
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      UPLOADS_DIR: uploadsDir,
      PORT: "3107",
      RUNTIME_STORAGE_ISOLATION: "strict",
      AOHUANG_ALLOW_RUNTIME_DIR_OVERRIDE: "1",
      MEDIA_RETENTION_HOURS: "24",
      APP_AUTH_PERSISTENCE_MODE: "json",
      LIBRARY_STORAGE_BACKEND: "json",
      GENERATION_JOBS_BACKEND: "existing",
      DATABASE_LIBRARY_DUAL_WRITE: "false",
      DATABASE_LIBRARY_READ_ENABLED: "false",
      DATABASE_JOBS_WRITE_ENABLED: "false",
      ...envOverrides,
    },
    encoding: "utf8",
    shell: false,
  });
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    assert.fail(`expected JSON output, got:\n${text}\n${error instanceof Error ? error.message : String(error)}`);
  }
}

function readLibrary() {
  return JSON.parse(readFileSync(join(dataDir, "library.json"), "utf8"));
}

function writeLibrary(items) {
  writeFileSync(join(dataDir, "library.json"), JSON.stringify(items, null, 2));
}

function markUnexpired(id) {
  writeLibrary(readLibrary().map((item) => (
    item.id === id
      ? {
          ...item,
          completedAt: hoursAgo(23.5),
          expiresAt: undefined,
        }
      : item
  )));
}

function assertExpired(items, id) {
  const item = items.find((candidate) => candidate.id === id);
  assert(item, `missing library item ${id}`);
  assert.equal(item.expired, true, `${id} should be marked expired`);
  assert.equal(item.output, undefined, `${id} output should be cleared`);
  assert.equal(typeof item.expiredAt, "string", `${id} should have expiredAt`);
}

function assertStillAvailable(items, id, storedName) {
  const item = items.find((candidate) => candidate.id === id);
  assert(item, `missing library item ${id}`);
  assert.equal(item.expired, undefined, `${id} should not be marked expired`);
  assert.equal(item.output?.storedName, storedName, `${id} output should be preserved`);
}

function assertActivePointsToExistingFile(items, uploadsDir) {
  for (const item of items) {
    if (item.expired || item.expirationPending) continue;
    if (item.id === "missing-file") continue;
    const storedName = item.output?.storedName;
    if (!storedName) continue;
    if (storedName !== basename(storedName)) continue;
    assert.equal(existsSync(join(uploadsDir, storedName)), true, `${item.id} active record points to a missing file`);
  }
}

function assertNoQuarantineFiles(uploadsDir, token) {
  const quarantineDir = join(uploadsDir, ".retention-quarantine");
  if (!existsSync(quarantineDir)) return;
  const leftovers = readdirSync(quarantineDir).filter((name) => name.includes(token));
  assert.deepEqual(leftovers, [], `quarantine still contains files for ${token}`);
}

function assertSanitizedOutput(outputText) {
  assert(!outputText.includes(resolve(dataDir)), "output must not include absolute DATA_DIR");
  assert(!outputText.includes(resolve(uploadsDir)), "output must not include absolute UPLOADS_DIR");
  assert(!outputText.includes("secret prompt"), "output must not include prompts");
  assert(!/(token|password|secret|api[_-]?key)=/i.test(outputText), "output must not print secrets");
}

function outputMessage(result) {
  return `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`;
}
