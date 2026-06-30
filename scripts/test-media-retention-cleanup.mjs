#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
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

  const missingConfirm = runCleanup(["--apply"]);
  assert.notEqual(missingConfirm.status, 0, "apply without confirmation must fail");
  assert.match(missingConfirm.stderr, /apply_requires_confirmation/);

  const apply = runCleanup(["--apply", "--confirm-apply"]);
  assert.equal(apply.status, 0, outputMessage(apply));
  const applyOutput = parseJson(apply.stdout);
  assert.equal(applyOutput.mode, "apply");
  assert.equal(applyOutput.deletedFiles, 1, "only the existing expired regular file should be deleted");
  assert.equal(applyOutput.expiredItems, 2, "expired existing and missing files should converge to expired records");
  assert.equal(existsSync(join(uploadsDir, "expired-video.mp4")), false);
  assert.equal(existsSync(join(uploadsDir, "fresh-image.png")), true);
  assert.equal(existsSync(join(uploadsDir, "generating-video.mp4")), true);
  assert.equal(existsSync(join(outsideDir, "outside.mp4")), true);
  assertSanitizedOutput(apply.stdout + apply.stderr);

  const afterApply = readLibrary();
  assertExpired(afterApply, "expired-video");
  assertExpired(afterApply, "missing-file");
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

function assertSanitizedOutput(outputText) {
  assert(!outputText.includes(resolve(dataDir)), "output must not include absolute DATA_DIR");
  assert(!outputText.includes(resolve(uploadsDir)), "output must not include absolute UPLOADS_DIR");
  assert(!outputText.includes("secret prompt"), "output must not include prompts");
  assert(!/(token|password|secret|api[_-]?key)=/i.test(outputText), "output must not print secrets");
}

function outputMessage(result) {
  return `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`;
}
