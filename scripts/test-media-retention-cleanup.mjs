#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
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
const quarantineDir = join(uploadsDir, ".retention-quarantine");
let symlinkCreated = false;

try {
  await mkdir(dataDir, { recursive: true });
  await mkdir(uploadsDir, { recursive: true });
  await mkdir(outsideDir, { recursive: true });
  await mkdir(quarantineDir, { recursive: true });

  writeFileSync(join(outsideDir, "outside.mp4"), "outside");
  try {
    symlinkSync(join(outsideDir, "outside.mp4"), join(uploadsDir, "linked.mp4"));
    symlinkCreated = true;
  } catch {
    symlinkCreated = false;
  }

  await resetFixture();

  const defaultDryRun = runCleanup([]);
  assert.equal(defaultDryRun.status, 0, outputMessage(defaultDryRun));
  const defaultDryRunOutput = parseJson(defaultDryRun.stdout);
  assert.equal(defaultDryRunOutput.mode, "dry-run");
  assert.equal(defaultDryRunOutput.deletedFiles, 0);

  const dryRun = runCleanup(["--dry-run"]);
  assert.equal(dryRun.status, 0, outputMessage(dryRun));
  const dryRunOutput = parseJson(dryRun.stdout);
  assert.equal(dryRunOutput.mode, "dry-run");
  assert(dryRunOutput.candidates >= 4, "dry-run should find expired local media candidates");
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

  await assertWindow("pending persisted then crash before rename", "after-pending", {
    env: { AOHUANG_TEST_FAIL_MEDIA_EXPIRATION_AFTER_PENDING: "after-pending" },
    assertAfterFail() {
      const item = findItem("after-pending");
      assert.equal(item.expirationStage, "pending");
      assert.equal(existsSync(join(uploadsDir, "after-pending.mp4")), true);
      assert.equal(existsSync(quarantinePath(item)), false);
    },
  });

  await assertWindow("rename then crash before quarantined persistence", "after-rename", {
    env: { AOHUANG_TEST_FAIL_MEDIA_EXPIRATION_AFTER_RENAME: "after-rename" },
    assertAfterFail() {
      const item = findItem("after-rename");
      assert.equal(item.expirationStage, "pending");
      assert.equal(existsSync(join(uploadsDir, "after-rename.mp4")), false);
      assert.equal(existsSync(quarantinePath(item)), true);
      assertActivePointsToExistingFile(readLibrary(), uploadsDir);
    },
  });

  await assertWindow("fileDeleted persisted then final JSON write fails", "json-final-fail", {
    env: { AOHUANG_TEST_FAIL_EXPIRATION_FINAL_JSON: "json-final-fail" },
    assertAfterFail() {
      const item = findItem("json-final-fail");
      assert.equal(item.expirationStage, "fileDeleted");
      assert.equal(item.expired, undefined);
      assert.equal(existsSync(join(uploadsDir, "json-final-fail.mp4")), false);
      assert.equal(existsSync(quarantinePath(item)), false);
      assertActivePointsToExistingFile(readLibrary(), uploadsDir);
    },
  });

  await assertWindow("fileDeleted persisted then final database write fails", "db-final-fail", {
    env: {
      LIBRARY_STORAGE_BACKEND: "database",
      DATABASE_LIBRARY_DUAL_WRITE: "true",
      AOHUANG_TEST_SIMULATE_DATABASE_WRITES: "1",
      AOHUANG_TEST_FAIL_EXPIRATION_FINAL_DATABASE: "db-final-fail",
    },
    assertAfterFail() {
      const item = findItem("db-final-fail");
      assert.equal(item.expirationStage, "fileDeleted");
      assert.equal(item.expired, undefined);
      assert.equal(existsSync(join(uploadsDir, "db-final-fail.mp4")), false);
      assert.equal(existsSync(quarantinePath(item)), false);
    },
  });

  await assertWindow("unlink EACCES leaves quarantined retry state", "unlink-eacces", {
    env: { AOHUANG_TEST_FAIL_MEDIA_EXPIRATION_UNLINK: "unlink-eacces:EACCES" },
    assertAfterFail() {
      const item = findItem("unlink-eacces");
      assert.equal(item.expirationStage, "quarantined");
      assert.equal(existsSync(join(uploadsDir, "unlink-eacces.mp4")), false);
      assert.equal(existsSync(quarantinePath(item)), true);
      assertActivePointsToExistingFile(readLibrary(), uploadsDir);
    },
  });

  await assertWindow("unlink EBUSY leaves quarantined retry state", "unlink-ebusy", {
    env: { AOHUANG_TEST_FAIL_MEDIA_EXPIRATION_UNLINK: "unlink-ebusy:EBUSY" },
    assertAfterFail() {
      const item = findItem("unlink-ebusy");
      assert.equal(item.expirationStage, "quarantined");
      assert.equal(existsSync(join(uploadsDir, "unlink-ebusy.mp4")), false);
      assert.equal(existsSync(quarantinePath(item)), true);
    },
  });

  await resetFixture();

  const missingConfirm = runCleanup(["--apply"]);
  assert.notEqual(missingConfirm.status, 0, "apply without confirmation must fail");
  assert.match(missingConfirm.stderr, /apply_requires_confirmation/);

  const apply = runCleanup(["--apply", "--confirm-apply"]);
  assert.equal(apply.status, 0, outputMessage(apply));
  const applyOutput = parseJson(apply.stdout);
  assert.equal(applyOutput.mode, "apply");
  assert.equal(existsSync(join(uploadsDir, "expired-video.mp4")), false);
  assert.equal(existsSync(join(uploadsDir, "fresh-image.png")), true);
  assert.equal(existsSync(join(uploadsDir, "generating-video.mp4")), true);
  assert.equal(existsSync(join(outsideDir, "outside.mp4")), true);
  assertSanitizedOutput(apply.stdout + apply.stderr);

  const afterApply = readLibrary();
  for (const id of [
    "expired-video",
    "missing-file",
    "pending-original",
    "pending-quarantine",
    "quarantined-orphan",
    "file-deleted",
    "expired-orphan",
    "after-pending",
    "after-rename",
    "json-final-fail",
    "db-final-fail",
    "unlink-eacces",
    "unlink-ebusy",
  ]) {
    assertExpired(afterApply, id);
    assertNoQuarantineFiles(uploadsDir, id);
  }
  assertStillAvailable(afterApply, "fresh-image", "fresh-image.png");
  assertStillAvailable(afterApply, "generating-video", "generating-video.mp4");
  assert.equal(afterApply.find((item) => item.id === "external-url")?.output?.url, "https://cdn.example.invalid/result.png");
  assert.equal(afterApply.find((item) => item.id === "path-escape")?.expired, undefined);
  if (symlinkCreated) assert.equal(afterApply.find((item) => item.id === "symlink-escape")?.expired, undefined);
  assertActivePointsToExistingFile(afterApply, uploadsDir);

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
    pendingCrashRecovered: true,
    renameCrashRecovered: true,
    jsonFinalFailureRetryRecovered: true,
    databaseFinalFailureRetryRecovered: true,
    unlinkEaccesRetryRecovered: true,
    unlinkEbusyRetryRecovered: true,
    quarantineOrphanConverged: true,
    invalidRetentionDefaulted: true,
    realRuntimeAccessed: false,
  }, null, 2));
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

async function resetFixture() {
  for (const name of readdirSync(uploadsDir)) {
    if (name === "linked.mp4" && symlinkCreated) continue;
    rmSync(join(uploadsDir, name), { recursive: true, force: true });
  }
  await mkdir(quarantineDir, { recursive: true });

  for (const name of [
    "expired-video.mp4",
    "fresh-image.png",
    "generating-video.mp4",
    "after-pending.mp4",
    "after-rename.mp4",
    "json-final-fail.mp4",
    "db-final-fail.mp4",
    "unlink-eacces.mp4",
    "unlink-ebusy.mp4",
    "pending-original.mp4",
  ]) {
    writeFileSync(join(uploadsDir, name), name);
  }

  writeFileSync(join(quarantineDir, qName("pending-quarantine", "pending-quarantine.mp4")), "pending-quarantine");
  writeFileSync(join(quarantineDir, qName("quarantined-orphan", "quarantined-orphan.mp4")), "quarantined-orphan");
  writeFileSync(join(quarantineDir, qName("expired-orphan", "expired-orphan.mp4")), "expired-orphan");

  writeFileSync(join(dataDir, "library.json"), JSON.stringify([
    libraryItem("expired-video", { type: "video", completedAt: hoursAgo(24.1), output: output("expired-video.mp4", "video/mp4", 13) }),
    libraryItem("fresh-image", { type: "image", completedAt: hoursAgo(23.9), output: output("fresh-image.png", "image/png", 11) }),
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
    libraryItem("missing-file", { type: "image", output: output("missing.png", "image/png", 7) }),
    libraryItem("path-escape", { type: "video", completedAt: hoursAgo(26), output: output("../escape.mp4", "video/mp4", 8) }),
    ...(symlinkCreated ? [libraryItem("symlink-escape", { type: "video", completedAt: hoursAgo(26), output: output("linked.mp4", "video/mp4", 8) })] : []),
    libraryItem("after-pending", { type: "video", output: output("after-pending.mp4", "video/mp4", 14) }),
    libraryItem("after-rename", { type: "video", output: output("after-rename.mp4", "video/mp4", 12) }),
    libraryItem("json-final-fail", { type: "video", output: output("json-final-fail.mp4", "video/mp4", 19) }),
    libraryItem("db-final-fail", { type: "video", output: output("db-final-fail.mp4", "video/mp4", 17) }),
    libraryItem("unlink-eacces", { type: "video", output: output("unlink-eacces.mp4", "video/mp4", 17) }),
    libraryItem("unlink-ebusy", { type: "video", output: output("unlink-ebusy.mp4", "video/mp4", 17) }),
    libraryItem("pending-original", pendingState("pending-original", "pending-original.mp4", "pending", true)),
    libraryItem("pending-quarantine", pendingState("pending-quarantine", "pending-quarantine.mp4", "pending", false)),
    libraryItem("quarantined-orphan", pendingState("quarantined-orphan", "quarantined-orphan.mp4", "quarantined", false)),
    libraryItem("file-deleted", pendingState("file-deleted", "file-deleted.mp4", "fileDeleted", false)),
    libraryItem("expired-orphan", {
      type: "video",
      output: undefined,
      expired: true,
      expiredAt: hoursAgo(24.5),
      expiresAt: hoursAgo(24.5),
      expirationQuarantineName: qName("expired-orphan", "expired-orphan.mp4"),
    }),
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
}

async function assertWindow(name, id, options) {
  await resetFixture();
  isolateCandidate(id);
  const failed = runCleanup(["--apply", "--confirm-apply"], options.env);
  assert.notEqual(failed.status, 0, `${name} must fail first`);
  options.assertAfterFail();
  assertSanitizedOutput(failed.stdout + failed.stderr);
  const recovered = runCleanup(["--apply", "--confirm-apply"]);
  assert.equal(recovered.status, 0, outputMessage(recovered));
  const item = findItem(id);
  assert.equal(item.expired, true, `${id} should converge to expired after retry`);
  assert.equal(item.output, undefined, `${id} output should be cleared after retry`);
  assertNoQuarantineFiles(uploadsDir, id);
}

function isolateCandidate(id) {
  const keepIds = new Set([
    id,
    "fresh-image",
    "generating-video",
    "external-url",
    "path-escape",
    ...(symlinkCreated ? ["symlink-escape"] : []),
  ]);
  const items = readLibrary().filter((item) => keepIds.has(item.id));
  assert(items.some((item) => item.id === id), `missing isolated candidate ${id}`);
  writeFileSync(join(dataDir, "library.json"), JSON.stringify(items, null, 2));
}

function pendingState(id, storedName, stage, originalExists) {
  return {
    type: "video",
    output: originalExists ? output(storedName, "video/mp4", 8) : undefined,
    expirationPending: true,
    expirationStage: stage,
    expirationPendingAt: hoursAgo(24.1),
    expirationPendingStoredName: storedName,
    expirationQuarantineName: qName(id, storedName),
    fileAvailable: false,
  };
}

function qName(id, storedName) {
  return `media-expiration-${id}-2026-06-29T00-00-00.000Z-${storedName}`;
}

function quarantinePath(item) {
  return join(quarantineDir, item.expirationQuarantineName);
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

function findItem(id) {
  const item = readLibrary().find((candidate) => candidate.id === id);
  assert(item, `missing library item ${id}`);
  return item;
}

function assertExpired(items, id) {
  const item = items.find((candidate) => candidate.id === id);
  assert(item, `missing library item ${id}`);
  assert.equal(item.expired, true, `${id} should be marked expired`);
  assert.equal(item.output, undefined, `${id} output should be cleared`);
  assert.equal(typeof item.expiredAt, "string", `${id} should have expiredAt`);
  assert.equal(item.expirationPending, undefined, `${id} pending flag should be cleared`);
  assert.equal(item.expirationStage, undefined, `${id} stage should be cleared`);
  assert.equal(item.expirationQuarantineName, undefined, `${id} quarantine name should be cleared`);
}

function assertStillAvailable(items, id, storedName) {
  const item = items.find((candidate) => candidate.id === id);
  assert(item, `missing library item ${id}`);
  assert.equal(item.expired, undefined, `${id} should not be marked expired`);
  assert.equal(item.output?.storedName, storedName, `${id} output should be preserved`);
}

function assertActivePointsToExistingFile(items, uploadsDir) {
  for (const item of items) {
    if (item.expired || item.expirationPending || item.expirationStage) continue;
    if (item.id === "missing-file") continue;
    const storedName = item.output?.storedName;
    if (!storedName) continue;
    if (storedName !== basename(storedName)) continue;
    assert.equal(existsSync(join(uploadsDir, storedName)), true, `${item.id} active record points to a missing file`);
  }
}

function assertNoQuarantineFiles(uploadsDir, token) {
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
