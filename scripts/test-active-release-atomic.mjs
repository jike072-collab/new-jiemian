#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import {
  getActiveReleaseFile,
  readActiveRelease,
  writeActiveRelease,
  writeJsonAtomically,
} from "./ops/active-release.mjs";
import { runWatchdog } from "./ops/watchdog-service.mjs";
import { acquireServiceOperationLock, releaseServiceOperationLock } from "./ops/operation-lock.mjs";
import { getServiceConfig } from "./ops/service-config.mjs";
import { getServiceStatus } from "./ops/service-status.mjs";
import { startService } from "./ops/start-service.mjs";

const tests = [];
let passed = 0;
let failed = 0;
const secret = "ops-test-secret-value-12345";

function test(name, fn) {
  tests.push({ name, fn });
}

async function withTempServiceRoot(fn) {
  const root = await mkdtemp(join(tmpdir(), "active-release atomics 中文 path "));
  try {
    await seedServiceRoot(root);
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function withTempServicePair(fn) {
  const root = await mkdtemp(join(tmpdir(), "active-release pair "));
  const productionRoot = join(root, "production service");
  const stagingRoot = join(root, "staging service");
  try {
    await seedServiceRoot(productionRoot);
    await seedServiceRoot(stagingRoot);
    return await fn({ productionRoot, stagingRoot });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function seedServiceRoot(root) {
  mkdirSync(join(root, "data"), { recursive: true });
  mkdirSync(join(root, "uploads"), { recursive: true });
  mkdirSync(join(root, "data-staging"), { recursive: true });
  mkdirSync(join(root, "uploads-staging"), { recursive: true });
  mkdirSync(join(root, ".runtime"), { recursive: true });
  mkdirSync(join(root, "node_modules", "next", "dist", "bin"), { recursive: true });
  mkdirSync(join(root, "node_modules", "@next", "env"), { recursive: true });
  await writeFile(join(root, "package.json"), "{}\n");
  await writeFile(join(root, "node_modules", "next", "dist", "bin", "next"), "next\n");
  await writeFile(join(root, "node_modules", "@next", "env", "package.json"), "{}\n");
  await writeFile(join(root, ".env.local"), [
    `AUTH_SESSION_SECRET=${secret}`,
    "APP_DATABASE_URL=postgresql://prod_user:prod_pass@127.0.0.1:5432/prod_db",
    "APP_DATABASE_EXPECTED_NAME=prod_db",
    "APP_AUTH_PERSISTENCE_MODE=postgres",
    "APP_BILLING_PERSISTENCE_MODE=postgres",
    "APP_TASK_BILLING_PERSISTENCE_MODE=postgres",
    "NEW_API_ENABLED=true",
    "NEW_API_BASE_URL=https://prod.example.test",
    "NEW_API_ENVIRONMENT=production",
    "NEW_API_ADMIN_USER_ID=1",
    "NEW_API_ADMIN_ACCESS_TOKEN=prod-token-secret",
    "",
  ].join("\n"));
  await writeFile(join(root, ".runtime", "staging.env"), [
    "AUTH_SESSION_SECRET=staging-secret-value-12345",
    "APP_DATABASE_URL=postgresql://staging_user:staging_pass@127.0.0.1:5432/staging_db",
    "APP_DATABASE_EXPECTED_NAME=staging_db",
    "APP_AUTH_PERSISTENCE_MODE=postgres",
    "APP_BILLING_PERSISTENCE_MODE=postgres",
    "APP_TASK_BILLING_PERSISTENCE_MODE=postgres",
    "NEW_API_ENABLED=true",
    "NEW_API_BASE_URL=https://staging.example.test",
    "NEW_API_ENVIRONMENT=production",
    "NEW_API_ADMIN_USER_ID=1",
    "NEW_API_ADMIN_ACCESS_TOKEN=staging-token-secret",
    "",
  ].join("\n"));
}

function createReleaseRoot(config, name = "release 01") {
  const root = join(config.runtimeDir, "releases", name);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "package.json"), "{}\n");
  return root;
}

function parseFile(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

test("first active release write creates newline-terminated valid JSON", async () => {
  await withTempServiceRoot(async (root) => {
    const config = getServiceConfig("staging", { root });
    const releaseRoot = createReleaseRoot(config, "release with space");
    const stored = writeActiveRelease(config, {
      releaseRoot,
      runtimeCommit: "a".repeat(40),
    });
    const file = getActiveReleaseFile(config);
    assert.equal(existsSync(file), true);
    const text = readFileSync(file, "utf8");
    assert(text.endsWith("\n"));
    assert.equal(parseFile(file).releaseRoot, releaseRoot);
    assert.equal(stored.releaseId, basename(releaseRoot));
  });
});

test("overwriting active release replaces old content without mixed JSON", async () => {
  await withTempServiceRoot(async (root) => {
    const config = getServiceConfig("staging", { root });
    const oldRoot = createReleaseRoot(config, "old release");
    const newRoot = createReleaseRoot(config, "new release");
    writeActiveRelease(config, { releaseRoot: oldRoot, runtimeCommit: "1".repeat(40) });
    const before = readFileSync(getActiveReleaseFile(config), "utf8");
    writeActiveRelease(config, { releaseRoot: newRoot, runtimeCommit: "2".repeat(40) });
    const after = readFileSync(getActiveReleaseFile(config), "utf8");
    assert.notEqual(after, before);
    assert.equal(parseFile(getActiveReleaseFile(config)).releaseRoot, newRoot);
    assert(!after.includes("old release"));
  });
});

test("temp write failure preserves previous official file", async () => {
  await withTempServiceRoot(async (root) => {
    const config = getServiceConfig("staging", { root });
    const official = getActiveReleaseFile(config);
    const previousRoot = createReleaseRoot(config, "previous");
    writeActiveRelease(config, { releaseRoot: previousRoot, runtimeCommit: "3".repeat(40) });
    const previousText = readFileSync(official, "utf8");
    const nextRoot = createReleaseRoot(config, "next");
    assert.throws(() => writeActiveRelease(config, {
      releaseRoot: nextRoot,
      runtimeCommit: "4".repeat(40),
    }, {
      writerOptions: {
        writeFileSync: () => {
          throw new Error("simulated temp write failure");
        },
      },
    }), /temp write failure/);
    assert.equal(readFileSync(official, "utf8"), previousText);
  });
});

test("fsync failure preserves previous official file and removes temp file", async () => {
  await withTempServiceRoot(async (root) => {
    const config = getServiceConfig("staging", { root });
    const official = getActiveReleaseFile(config);
    const previousRoot = createReleaseRoot(config, "previous");
    writeActiveRelease(config, { releaseRoot: previousRoot, runtimeCommit: "5".repeat(40) });
    const previousText = readFileSync(official, "utf8");
    const nextRoot = createReleaseRoot(config, "next");
    assert.throws(() => writeActiveRelease(config, {
      releaseRoot: nextRoot,
      runtimeCommit: "6".repeat(40),
    }, {
      writerOptions: {
        fsyncSync: () => {
          throw new Error("simulated fsync failure");
        },
      },
    }), /fsync failure/);
    assert.equal(readFileSync(official, "utf8"), previousText);
    assert.equal(readdirSync(config.runtimeDir).filter((entry) => entry.includes(".tmp")).length, 0);
  });
});

test("rename failure preserves previous official file and removes temp file", async () => {
  await withTempServiceRoot(async (root) => {
    const config = getServiceConfig("staging", { root });
    const official = getActiveReleaseFile(config);
    const previousRoot = createReleaseRoot(config, "previous");
    writeActiveRelease(config, { releaseRoot: previousRoot, runtimeCommit: "7".repeat(40) });
    const previousText = readFileSync(official, "utf8");
    const nextRoot = createReleaseRoot(config, "next");
    assert.throws(() => writeActiveRelease(config, {
      releaseRoot: nextRoot,
      runtimeCommit: "8".repeat(40),
    }, {
      writerOptions: {
        renameSync: () => {
          throw new Error("simulated rename failure");
        },
      },
    }), /rename failure/);
    assert.equal(readFileSync(official, "utf8"), previousText);
    assert.equal(readdirSync(config.runtimeDir).filter((entry) => entry.includes(".tmp")).length, 0);
  });
});

test("JSON serialization failure leaves official file unchanged", async () => {
  await withTempServiceRoot(async (root) => {
    const config = getServiceConfig("staging", { root });
    const official = getActiveReleaseFile(config);
    const previousRoot = createReleaseRoot(config, "previous");
    writeActiveRelease(config, { releaseRoot: previousRoot, runtimeCommit: "9".repeat(40) });
    const previousText = readFileSync(official, "utf8");
    const circular = {};
    circular.self = circular;
    assert.throws(() => writeJsonAtomically(official, circular), /circular/i);
    assert.equal(readFileSync(official, "utf8"), previousText);
  });
});

test("reread verification failure restores previous file", async () => {
  await withTempServiceRoot(async (root) => {
    const config = getServiceConfig("staging", { root });
    const official = getActiveReleaseFile(config);
    const previousRoot = createReleaseRoot(config, "previous");
    const nextRoot = createReleaseRoot(config, "next");
    writeActiveRelease(config, { releaseRoot: previousRoot, runtimeCommit: "a".repeat(40) });
    const previousText = readFileSync(official, "utf8");
    assert.throws(() => writeActiveRelease(config, {
      releaseRoot: nextRoot,
      runtimeCommit: "b".repeat(40),
    }, {
      readBack: () => ({
        ...readActiveRelease(config),
        releaseRoot: previousRoot,
      }),
    }), /reread mismatch/);
    assert.equal(readFileSync(official, "utf8"), previousText);
  });
});

test("partial temp file residue does not affect official read", async () => {
  await withTempServiceRoot(async (root) => {
    const config = getServiceConfig("staging", { root });
    const releaseRoot = createReleaseRoot(config, "release");
    writeActiveRelease(config, { releaseRoot, runtimeCommit: "c".repeat(40) });
    writeFileSync(join(config.runtimeDir, `${basename(getActiveReleaseFile(config))}.partial.tmp`), "{broken");
    assert.equal(readActiveRelease(config).releaseRoot, releaseRoot);
  });
});

test("corrupt official JSON blocks service-status, start-service and watchdog guessing", async () => {
  await withTempServiceRoot(async (root) => {
    const config = getServiceConfig("staging", { root, port: "49999" });
    const releaseRoot = createReleaseRoot(config, "release");
    writeActiveRelease(config, { releaseRoot, runtimeCommit: "d".repeat(40) });
    writeFileSync(getActiveReleaseFile(config), "{not-json");
    await assertRejectsAsync(() => getServiceStatus("staging", { root, port: "49999" }), /Active release metadata is invalid/);
    await assertRejectsAsync(() => startService("staging", { root, preflightOnly: true }), /Active release metadata is invalid/);
    await assertRejectsAsync(() => runWatchdog("staging", { root, port: "49999", timeoutMs: 100 }), /Active release metadata is invalid/);
  });
});

test("production metadata rejects staging release root and vice versa", async () => {
  await withTempServicePair(async ({ productionRoot, stagingRoot }) => {
    const production = getServiceConfig("production", { root: productionRoot });
    const staging = getServiceConfig("staging", { root: stagingRoot });
    const stagingRelease = createReleaseRoot(staging, "staging release");
    const productionRelease = createReleaseRoot(production, "production release");
    assert.throws(() => writeActiveRelease(production, {
      releaseRoot: stagingRelease,
      runtimeCommit: "e".repeat(40),
    }), /different service root|same volume|escaped/);
    assert.throws(() => writeActiveRelease(staging, {
      releaseRoot: productionRelease,
      runtimeCommit: "f".repeat(40),
    }), /different service root|same volume|escaped/);
  });
});

test("releaseRoot path traversal is rejected", async () => {
  await withTempServiceRoot(async (root) => {
    const config = getServiceConfig("staging", { root });
    const escaped = join(config.runtimeDir, "releases", "..", "escape");
    mkdirSync(escaped, { recursive: true });
    writeFileSync(join(escaped, "package.json"), "{}\n");
    assert.throws(() => writeActiveRelease(config, {
      releaseRoot: escaped,
      runtimeCommit: "1".repeat(40),
    }), /escaped the service release directory/);
  });
});

test("Chinese and space paths are supported for active release metadata", async () => {
  await withTempServiceRoot(async (root) => {
    const config = getServiceConfig("staging", { root });
    const releaseRoot = createReleaseRoot(config, "版本 空格 中文");
    writeActiveRelease(config, { releaseRoot, runtimeCommit: "2".repeat(40) });
    const stored = readActiveRelease(config);
    assert.equal(stored.releaseRoot, releaseRoot);
    assert.equal(stored.releaseId, "版本 空格 中文");
  });
});

test("legacy metadata stays readable after atomic-write upgrade", async () => {
  await withTempServiceRoot(async (root) => {
    const config = getServiceConfig("staging", { root });
    const releaseRoot = createReleaseRoot(config, "legacy");
    writeFileSync(getActiveReleaseFile(config), JSON.stringify({
      version: 1,
      serviceName: "staging",
      service: "staging",
      serviceRoot: config.root,
      releaseRoot,
      runtimeCommit: "3".repeat(40),
      deploymentId: "legacy-id",
      activatedAt: "2026-06-26T00:00:00.000Z",
      updatedAt: "2026-06-26T00:00:00.000Z",
    }, null, 2));
    const stored = readActiveRelease(config);
    assert.equal(stored.releaseRoot, releaseRoot);
    assert.equal(stored.releaseId, "legacy");
    assert.equal(stored.status, "active");
  });
});

test("concurrent writers produce a complete JSON file without temp residue", async () => {
  await withTempServiceRoot(async (root) => {
    const config = getServiceConfig("staging", { root });
    const releaseA = createReleaseRoot(config, "release-a");
    const releaseB = createReleaseRoot(config, "release-b");
    const worker = join(process.cwd(), "scripts", "test-fixtures-active-release-worker.mjs");
    const [one, two] = await Promise.all([
      runWorker(worker, root, "staging", releaseA, "4".repeat(40)),
      runWorker(worker, root, "staging", releaseB, "5".repeat(40)),
    ]);
    assert.equal(one.code, 0, one.output);
    assert.equal(two.code, 0, two.output);
    const text = readFileSync(getActiveReleaseFile(config), "utf8");
    assert.doesNotThrow(() => JSON.parse(text));
    const finalPayload = parseFile(getActiveReleaseFile(config));
    assert(["release-a", "release-b"].includes(finalPayload.releaseId));
    assert.equal(readdirSync(config.runtimeDir).filter((entry) => entry.includes(".tmp")).length, 0);
  });
});

test("operation lock serializes active release updates", async () => {
  await withTempServiceRoot(async (root) => {
    const config = getServiceConfig("staging", { root });
    const lock = await acquireServiceOperationLock(config, "deploy", { deploymentId: "lock-test" });
    try {
      await assertRejectsAsync(() => acquireServiceOperationLock(config, "deploy", { deploymentId: "lock-test-2" }), /refusing|lock/);
    } finally {
      releaseServiceOperationLock(lock);
    }
  });
});

test("failed update leaves previous active release still usable", async () => {
  await withTempServiceRoot(async (root) => {
    const config = getServiceConfig("staging", { root });
    const previousRoot = createReleaseRoot(config, "previous");
    const nextRoot = createReleaseRoot(config, "next");
    const previous = writeActiveRelease(config, { releaseRoot: previousRoot, runtimeCommit: "6".repeat(40) });
    assert.throws(() => writeActiveRelease(config, {
      releaseRoot: nextRoot,
      runtimeCommit: "7".repeat(40),
    }, {
      writerOptions: {
        renameSync: () => {
          throw new Error("rename blocked");
        },
      },
    }), /rename blocked/);
    const current = readActiveRelease(config);
    assert.deepEqual(current, previous);
  });
});

async function runWorker(script, root, service, releaseRoot, runtimeCommit) {
  return await new Promise((resolve) => {
    const child = spawn(process.execPath, [script, root, service, releaseRoot, runtimeCommit], {
      cwd: process.cwd(),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.on("exit", (code) => resolve({ code, output }));
  });
}

async function assertRejectsAsync(fn, pattern) {
  let rejected = null;
  try {
    await fn();
  } catch (error) {
    rejected = error;
  }
  assert(rejected, "Expected async function to reject.");
  assert.match(rejected.message, pattern);
}

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

console.log(`active release atomic tests: total=${tests.length} passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
