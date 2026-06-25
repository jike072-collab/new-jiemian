#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const projectRoot = process.cwd();
const modulePath = new URL("../src/lib/server/runtime-paths.ts", import.meta.url);
const runtimePaths = await import(`${modulePath.href}?test=${Date.now()}`);
const {
  ensureDataDir,
  ensureUploadsDir,
  getDataDir,
  getUploadsDir,
  resolveDataPath,
  resolveUploadPath,
  validateRuntimeStorageIsolation,
} = runtimePaths;

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

function env(values) {
  return { ...values };
}

function assertFails(name, input, match) {
  assert.throws(
    () => validateRuntimeStorageIsolation(env(input), projectRoot),
    (error) => error instanceof Error && error.name === "RuntimeStorageIsolationError" && match.test(error.message),
    name,
  );
}

async function withTempDirs(fn) {
  const root = await mkdtemp(join(tmpdir(), "aohuang-runtime-isolation-"));
  try {
    const dataDir = join(root, "data-temp");
    const uploadsDir = join(root, "uploads-temp");
    return await fn({ root, dataDir, uploadsDir });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function withProcessEnv(values, fn) {
  const previous = {
    PORT: process.env.PORT,
    DATA_DIR: process.env.DATA_DIR,
    UPLOADS_DIR: process.env.UPLOADS_DIR,
  };
  for (const key of Object.keys(previous)) {
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("PORT unset keeps default data/uploads compatibility", () => {
  const report = validateRuntimeStorageIsolation(env({}), projectRoot);
  assert.equal(report.dataDir, resolve(projectRoot, "data"));
  assert.equal(report.uploadsDir, resolve(projectRoot, "uploads"));
});

test("PORT=3106 allows default data/uploads compatibility", () => {
  const report = validateRuntimeStorageIsolation(env({ PORT: "3106" }), projectRoot);
  assert.equal(report.dataDir, resolve(projectRoot, "data"));
  assert.equal(report.uploadsDir, resolve(projectRoot, "uploads"));
});

test("PORT=3107 rejects missing DATA_DIR and UPLOADS_DIR", () => {
  assertFails("missing both", { PORT: "3107" }, /DATA_DIR/);
});

test("PORT=3107 rejects missing UPLOADS_DIR", () => {
  assertFails("missing uploads", { PORT: "3107", DATA_DIR: "data-staging" }, /UPLOADS_DIR/);
});

test("PORT=3107 rejects missing DATA_DIR", () => {
  assertFails("missing data", { PORT: "3107", UPLOADS_DIR: "uploads-staging" }, /DATA_DIR/);
});

test("PORT=3107 rejects default data/uploads", () => {
  assertFails("default data uploads", { PORT: "3107", DATA_DIR: "data", UPLOADS_DIR: "uploads" }, /DATA_DIR|默认 data/);
});

test("PORT=3107 accepts data-staging/uploads-staging", () => {
  const report = validateRuntimeStorageIsolation(env({
    PORT: "3107",
    DATA_DIR: "data-staging",
    UPLOADS_DIR: "uploads-staging",
  }), projectRoot);
  assert.equal(report.dataDir, resolve(projectRoot, "data-staging"));
  assert.equal(report.uploadsDir, resolve(projectRoot, "uploads-staging"));
});

test("PORT=3107 accepts distinct absolute temporary paths", async () => {
  await withTempDirs(async ({ dataDir, uploadsDir }) => {
    const report = validateRuntimeStorageIsolation(env({ PORT: "3107", DATA_DIR: dataDir, UPLOADS_DIR: uploadsDir }), projectRoot);
    assert.equal(report.dataDir, resolve(dataDir));
    assert.equal(report.uploadsDir, resolve(uploadsDir));
  });
});

test("PORT=3107 rejects the same data and uploads directory", async () => {
  await withTempDirs(async ({ dataDir }) => {
    assertFails("same path", { PORT: "3107", DATA_DIR: dataDir, UPLOADS_DIR: `${dataDir}/` }, /同一个目录/);
  });
});

test("PORT=3107 rejects nested data/uploads directories", async () => {
  await withTempDirs(async ({ dataDir }) => {
    assertFails("uploads inside data", { PORT: "3107", DATA_DIR: dataDir, UPLOADS_DIR: join(dataDir, "nested") }, /UPLOADS_DIR 不能位于 DATA_DIR/);
    assertFails("data inside uploads", { PORT: "3107", DATA_DIR: join(dataDir, "nested"), UPLOADS_DIR: dataDir }, /DATA_DIR 不能位于 UPLOADS_DIR/);
  });
});

test("PORT=3107 rejects normalized paths that resolve to defaults", () => {
  assertFails("dot slash default", { PORT: "3107", DATA_DIR: "./data/", UPLOADS_DIR: "./uploads/" }, /默认 data/);
  assertFails("dot dot default", {
    PORT: "3107",
    DATA_DIR: "data-staging/../data",
    UPLOADS_DIR: "uploads-staging/../uploads",
  }, /默认 data/);
});

test("ensureRuntimeDirs creates only temporary isolated directories", async () => {
  await withTempDirs(async ({ root, dataDir, uploadsDir }) => {
    await withProcessEnv({ PORT: "3107", DATA_DIR: dataDir, UPLOADS_DIR: uploadsDir }, async () => {
      validateRuntimeStorageIsolation();
      await ensureDataDir();
      await ensureUploadsDir();
      assert.equal((await stat(dataDir)).isDirectory(), true);
      assert.equal((await stat(uploadsDir)).isDirectory(), true);
      const entries = await readdir(root);
      assert.deepEqual(entries.sort(), ["data-temp", "uploads-temp"]);
    });
  });
  assert.equal(existsSync(join(projectRoot, "data", "runtime-isolation-probe")), false);
  assert.equal(existsSync(join(projectRoot, "uploads", "runtime-isolation-probe")), false);
});

test("resolveDataPath and resolveUploadPath stay inside isolated roots", async () => {
  await withTempDirs(async ({ dataDir, uploadsDir }) => {
    await withProcessEnv({ PORT: "3107", DATA_DIR: dataDir, UPLOADS_DIR: uploadsDir }, () => {
      assert.equal(getDataDir(), resolve(dataDir));
      assert.equal(getUploadsDir(), resolve(uploadsDir));
      assert.equal(resolveDataPath("library.json"), join(resolve(dataDir), "library.json"));
      assert.equal(resolveUploadPath("image.png"), join(resolve(uploadsDir), "image.png"));
    });
  });
});

test("malicious file names cannot escape storage roots", async () => {
  await withTempDirs(async ({ dataDir, uploadsDir }) => {
    await withProcessEnv({ PORT: "3107", DATA_DIR: dataDir, UPLOADS_DIR: uploadsDir }, () => {
      assert.throws(() => resolveDataPath("../outside.json"), /不能逃出/);
      assert.throws(() => resolveUploadPath("../outside.png"), /不能逃出/);
    });
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

console.log(`runtime isolation tests: total=${tests.length} passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
