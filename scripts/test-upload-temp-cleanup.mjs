#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const root = process.cwd();
const script = join(root, "scripts/ops/cleanup-stale-runtime-temp.mjs");
const tempRoot = mkdtempSync(join(tmpdir(), "aohuang-temp-cleanup-"));
const dataDir = join(tempRoot, "runtime-data");
const uploadsDir = join(tempRoot, "runtime-uploads");
const fixtureFiles = [
  join(dataDir, "old-data.tmp"),
  join(dataDir, "nested", "old-nested.tmp"),
  join(uploadsDir, "old-upload.tmp"),
  join(dataDir, "new-data.tmp"),
  join(uploadsDir, "new-upload.tmp"),
  join(uploadsDir, "media.png"),
  join(uploadsDir, "video.mp4"),
  join(dataDir, "library.json"),
  join(dataDir, "app.sqlite"),
  join(dataDir, "runtime.log"),
  join(dataDir, "backup.bak"),
  join(dataDir, "library.json.tmp"),
  join(dataDir, "runtime.log.tmp"),
  join(dataDir, "backup.bak.tmp"),
  join(uploadsDir, "media.png.tmp"),
];

try {
  await mkdir(join(dataDir, "nested"), { recursive: true });
  await mkdir(uploadsDir, { recursive: true });
  for (const file of fixtureFiles) writeFileSync(file, "fixture");
  maybeCreateSymlink(join(dataDir, "linked-old.tmp"), join(dataDir, "old-data.tmp"));

  const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000);
  for (const file of [
    join(dataDir, "old-data.tmp"),
    join(dataDir, "nested", "old-nested.tmp"),
    join(uploadsDir, "old-upload.tmp"),
    join(uploadsDir, "media.png"),
    join(uploadsDir, "video.mp4"),
    join(dataDir, "library.json"),
    join(dataDir, "app.sqlite"),
    join(dataDir, "runtime.log"),
    join(dataDir, "backup.bak"),
    join(dataDir, "library.json.tmp"),
    join(dataDir, "runtime.log.tmp"),
    join(dataDir, "backup.bak.tmp"),
    join(uploadsDir, "media.png.tmp"),
  ]) {
    utimesSync(file, oldDate, oldDate);
  }

  const dryRun = runCleanup(["--dry-run"]);
  assert.equal(dryRun.status, 0, `dry-run failed\nstdout:\n${dryRun.stdout}\nstderr:\n${dryRun.stderr}`);
  const dryRunOutput = parseJson(dryRun.stdout);
  assert.equal(dryRunOutput.mode, "dry-run");
  assert.equal(dryRunOutput.deletedFiles, 0, "dry-run must not delete files");
  assert.equal(dryRunOutput.staleTmpFiles, 3, "dry-run should find only old unprotected regular tmp files");
  assertAllExist(fixtureFiles, "dry-run must leave every fixture file in place");
  assertSanitizedOutput(dryRun.stdout + dryRun.stderr);

  const missingConfirm = runCleanup(["--apply"]);
  assert.notEqual(missingConfirm.status, 0, "apply without confirmation must fail");
  assert.match(missingConfirm.stderr, /apply_requires_confirmation/, "apply refusal should be explicit");

  const apply = runCleanup(["--apply", "--confirm-runtime-cleanup", "--older-than-hours=24"]);
  assert.equal(apply.status, 0, `apply failed\nstdout:\n${apply.stdout}\nstderr:\n${apply.stderr}`);
  const applyOutput = parseJson(apply.stdout);
  assert.equal(applyOutput.mode, "apply");
  assert.equal(applyOutput.staleTmpFiles, 3, "apply should target only old regular tmp files");
  assert.equal(applyOutput.deletedFiles, 3, "apply should delete only old regular tmp files");
  assert.equal(existsSync(join(dataDir, "old-data.tmp")), false, "old data tmp should be deleted");
  assert.equal(existsSync(join(dataDir, "nested", "old-nested.tmp")), false, "old nested tmp should be deleted");
  assert.equal(existsSync(join(uploadsDir, "old-upload.tmp")), false, "old upload tmp should be deleted");
  assertAllExist([
    join(dataDir, "new-data.tmp"),
    join(uploadsDir, "new-upload.tmp"),
    join(uploadsDir, "media.png"),
    join(uploadsDir, "video.mp4"),
    join(dataDir, "library.json"),
    join(dataDir, "app.sqlite"),
    join(dataDir, "runtime.log"),
    join(dataDir, "backup.bak"),
    join(dataDir, "library.json.tmp"),
    join(dataDir, "runtime.log.tmp"),
    join(dataDir, "backup.bak.tmp"),
    join(uploadsDir, "media.png.tmp"),
  ], "apply must preserve non-stale or non-tmp fixtures");
  assertSanitizedOutput(apply.stdout + apply.stderr);

  await assertNoForbiddenDeletion(dataDir);
  await assertNoForbiddenDeletion(uploadsDir);

  const defaultRefusal = spawnSync(process.execPath, [script, "--dry-run"], {
    cwd: root,
    env: {
      ...process.env,
      DATA_DIR: "data",
      UPLOADS_DIR: "uploads",
    },
    encoding: "utf8",
    shell: false,
  });
  assert.notEqual(defaultRefusal.status, 0, "default production-like roots must be refused");
  assert.match(defaultRefusal.stderr, /default_runtime_root_refused/, "default root refusal should be explicit");
  assertSanitizedOutput(defaultRefusal.stdout + defaultRefusal.stderr);

  const defaultChildRefusal = spawnSync(process.execPath, [script, "--dry-run"], {
    cwd: root,
    env: {
      ...process.env,
      DATA_DIR: "data/tmp-fixture",
      UPLOADS_DIR: "uploads/tmp-fixture",
    },
    encoding: "utf8",
    shell: false,
  });
  assert.notEqual(defaultChildRefusal.status, 0, "children of default production-like roots must be refused");
  assert.match(defaultChildRefusal.stderr, /default_runtime_root_refused/, "default child root refusal should be explicit");
  assertSanitizedOutput(defaultChildRefusal.stdout + defaultChildRefusal.stderr);

  const missingRoots = spawnSync(process.execPath, [script, "--dry-run"], {
    cwd: root,
    env: {
      ...process.env,
      DATA_DIR: "",
      UPLOADS_DIR: "",
    },
    encoding: "utf8",
    shell: false,
  });
  assert.notEqual(missingRoots.status, 0, "missing explicit runtime roots must be refused");
  assert.match(missingRoots.stderr, /explicit_runtime_roots_required/, "missing root refusal should be explicit");

  console.log(JSON.stringify({
    ok: true,
    dryRunDeleted: 0,
    applyDeletedOldTmp: 3,
    mediaPreserved: true,
    jsonPreserved: true,
    dbLogBackupPreserved: true,
    defaultRootsRefused: true,
    symlinkTargetsFollowed: false,
    dataDirRealUploadsAccessed: false,
    realRuntimeDeleted: false,
  }, null, 2));
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

function runCleanup(args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      UPLOADS_DIR: uploadsDir,
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

function assertAllExist(files, message) {
  for (const file of files) {
    assert.equal(existsSync(file), true, `${message}: ${file}`);
  }
}

async function assertNoForbiddenDeletion(directory) {
  const entries = await listFiles(directory);
  for (const file of entries) {
    assert(!file.endsWith(".json.tmp.deleted"), `unexpected deleted marker: ${file}`);
  }
}

async function listFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(fullPath));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

function maybeCreateSymlink(linkPath, targetPath) {
  try {
    symlinkSync(targetPath, linkPath);
  } catch {
    return false;
  }
  return true;
}

function assertSanitizedOutput(output) {
  assert(!output.includes(resolve(dataDir)), "output must not include absolute DATA_DIR");
  assert(!output.includes(resolve(uploadsDir)), "output must not include absolute UPLOADS_DIR");
  assert(!/(secret|password|token|api[_-]?key)=/i.test(output), "output must not print secrets");
}
