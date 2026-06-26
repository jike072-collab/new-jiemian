#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join, parse, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { clearActiveRelease, readActiveRelease, restoreActiveRelease, writeActiveRelease } from "./active-release.mjs";
import {
  cleanupRestoredDirectories,
  createServiceBackup,
  restoreDataAndUploads,
  rollbackRestoredDirectories,
  snapshotDirectory,
  verifyBackupManifest,
  writeRollbackScript,
} from "./backup-utils.mjs";
import { buildRuntimeEnv } from "./load-runtime-env.mjs";
import { getServiceConfig } from "./service-config.mjs";
import { checkServiceHealth } from "./health-check.mjs";
import { startService } from "./start-service.mjs";
import { stopService } from "./stop-service.mjs";
import { getListeningPid, isPortAvailable, run, runSync, wait } from "./process-utils.mjs";
import { safeGit } from "./git-utils.mjs";
import { createDatabaseRestoreAuthorization, prepareDatabaseRestore, restoreDatabaseBackup, writeDatabaseRestoreAuthorizationFile } from "./database-restore.mjs";
import { acquireServiceOperationLock, markServiceOperationFailed, releaseServiceOperationLock, touchServiceOperationLock } from "./operation-lock.mjs";

const validationCheckCommands = [
  ["npm", ["ci"]],
  ["npm", ["run", "lint"]],
  ["npm", ["run", "typecheck"]],
  ["npm", ["run", "test:runtime-isolation"]],
  ["npm", ["run", "check:runtime-paths"]],
  ["npm", ["run", "test:security-release"]],
  ["npm", ["run", "test:ops"]],
  ["npm", ["run", "build"]],
  ["npm", ["run", "test:staging-smoke"]],
  ["npm", ["run", "check"]],
];

const rollbackCandidateCommands = [
  ["npm", ["ci"]],
  ["npm", ["run", "lint"]],
  ["npm", ["run", "typecheck"]],
  ["npm", ["run", "build"]],
];

export async function deployService(service, options = {}) {
  const config = getServiceConfig(service, options);
  const target = options.target || "origin/main";
  const deploymentId = randomUUID();
  let serviceStopped = false;
  let runtime = null;
  let targetCommit = null;
  let backup = null;
  let rollbackAuthorization = null;
  let preparedRelease = null;
  let previousActiveRelease = null;
  let activatedRelease = null;
  const before = {
    pid: getListeningPid(config.port),
    commit: safeGit(config.root, ["rev-parse", "HEAD"]),
    data: snapshotDirectory(config.dataDir),
    uploads: snapshotDirectory(config.uploadsDir),
  };
  let operationLock = null;
  const report = {
    service,
    root: config.root,
    port: config.port,
    target,
    deploymentId,
    startedAt: new Date().toISOString(),
    before,
    backup: null,
    rollback: null,
    checks: [],
    success: false,
  };

  try {
    operationLock = await acquireServiceOperationLock(config, "deploy", { deploymentId, target });
    assertCleanWorktree(config.root);
    runSync("git", ["fetch", "origin"], { cwd: config.root });
    targetCommit = runSync("git", ["rev-parse", target], { cwd: config.root }).stdout.trim();
    report.targetCommit = targetCommit;
    checkDiskSpace(config.root);

    runtime = buildRuntimeEnv(service, { root: config.root });
    if (runtime.missing.length) {
      throw new Error(`Missing required runtime configuration before stopping old process: ${runtime.missing.join(", ")}`);
    }

    preparedRelease = await validateTargetInWorktree(service, config, runtime, targetCommit, report);

    backup = createServiceBackup(config, { note: `before deploy to ${targetCommit}`, env: runtime.env, deploymentId });
    const backupManifest = verifyBackupManifest(config, backup.backupDir);
    rollbackAuthorization = createDatabaseRestoreAuthorization(config, backupManifest, runtime.env, {
      deploymentId,
      backupDir: backup.backupDir,
      sourceCommit: before.commit,
      targetCommit,
    });
    const rollbackAuthorizationFile = writeDatabaseRestoreAuthorizationFile(config, backupManifest, rollbackAuthorization);
    const rollbackScript = writeRollbackScript(config, backup, before.commit);
    report.backup = backup.backupDir;
    report.rollback = rollbackScript;
    report.rollbackAuthorizationFile = rollbackAuthorizationFile;

    if (!options.dryRun) {
      previousActiveRelease = readActiveRelease(config, { optional: true });
      await stopService(service, { root: config.root });
      serviceStopped = true;
      runSync("git", ["checkout", "--detach", targetCommit], { cwd: config.root });
      activatedRelease = writeActiveRelease(config, {
        releaseRoot: preparedRelease.root,
        runtimeCommit: targetCommit,
        deploymentId,
      });
      report.releaseRoot = activatedRelease.releaseRoot;
      report.activeReleaseFile = config.activeReleaseFile;
      await startService(service, { root: config.root, preflightOnly: true });
      report.checks.push({ command: "service start-service --preflight-only", ok: true });
      await startService(service, { root: config.root });
      await wait(1500);
      const health = await checkServiceHealth(service, { root: config.root, repeat: 10 });
      report.health = health;
      if (!health.ok) throw new Error(`${service} health check failed after deploy.`);
      const after = {
        pid: getListeningPid(config.port),
        commit: safeGit(config.root, ["rev-parse", "HEAD"]),
        data: snapshotDirectory(config.dataDir),
        uploads: snapshotDirectory(config.uploadsDir),
      };
      report.after = after;
      assertNoDataLoss(before, after);
    }
    report.success = true;
    return report;
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
    if (!options.dryRun && serviceStopped) {
      await stopService(service, { root: config.root }).catch(() => null);
      if (before.commit && before.commit !== "unknown") {
        runSync("git", ["checkout", "--detach", before.commit], { cwd: config.root, allowStatus: [0, 128] });
      }
      restoreActiveRelease(config, previousActiveRelease);
      await startService(service, { root: config.root });
      report.previousArtifactsRestarted = true;
      report.recoveryHealth = await checkServiceHealth(service, { root: config.root, repeat: 10 });
      if (!report.recoveryHealth.ok) {
        throw Object.assign(new Error(`${service} previous release restart health check failed.`), { report });
      }
    }
    throw Object.assign(new Error(report.error), { report });
  } finally {
    if (!report.success && activatedRelease && previousActiveRelease == null) {
      clearActiveRelease(config);
    }
    if (preparedRelease?.scratchRoot) rmSync(preparedRelease.scratchRoot, { recursive: true, force: true });
    releaseServiceOperationLock(operationLock);
    mkdirSync(config.runtimeDir, { recursive: true });
    writeFileSync(join(config.runtimeDir, `deploy-${service}-last.json`), JSON.stringify(report, null, 2));
  }
}

async function validateTargetInWorktree(service, config, runtime, targetCommit, report) {
  const validationRoot = createReleaseCandidateRoot(config, targetCommit, report.deploymentId);
  const validationScratchRoot = join(config.runtimeDir, "release-smoke", basename(validationRoot));
  report.validationRoot = validationRoot;
  report.validationScratchRoot = validationScratchRoot;
  try {
    runSync("git", ["worktree", "add", "--detach", validationRoot, targetCommit], { cwd: config.root });
    const validationConfig = getServiceConfig(service, { root: validationRoot, port: config.port });
    const verificationEnv = buildVerificationEnv(process.env, { includeRuntimeConfig: false });
    const smokeEnv = {
      ...buildVerificationEnv(runtime.env, { includeRuntimeConfig: true }),
      AOHUANG_ALLOW_RUNTIME_DIR_OVERRIDE: "1",
      DATA_DIR: join(validationScratchRoot, "data"),
      UPLOADS_DIR: join(validationScratchRoot, "uploads"),
      STAGING_SMOKE_PORT: String(await findTemporaryPort()),
    };
    for (const [command, args] of validationCheckCommands) {
      const commandEnv = command === "npm" && args.join(" ") === "run test:staging-smoke" ? smokeEnv : verificationEnv;
      await run(command, args, { cwd: validationRoot, env: commandEnv });
      report.checks.push({ command: `validation ${command} ${args.join(" ")}`, ok: true });
    }
    await run(process.execPath, ["scripts/ops/start-service.mjs", service, "--preflight-only", "--root", validationRoot], {
      cwd: validationRoot,
      env: {
        ...runtime.env,
        AOHUANG_ALLOW_RUNTIME_DIR_OVERRIDE: "1",
        DATA_DIR: smokeEnv.DATA_DIR,
        UPLOADS_DIR: smokeEnv.UPLOADS_DIR,
      },
    });
    report.checks.push({ command: "validation start-service --preflight-only", ok: true });
    assertReleaseCandidateSafe(config, validationRoot, validationConfig);
    report.releaseRoot = validationRoot;
    return { root: validationRoot, scratchRoot: validationScratchRoot };
  } catch (error) {
    rmSync(validationScratchRoot, { recursive: true, force: true });
    throw error;
  }
}

export function createReleaseCandidateRoot(config, targetCommit, deploymentId = randomUUID()) {
  const shortCommit = String(targetCommit || "unknown").slice(0, 12).replace(/[^a-f0-9]/gi, "x");
  const safeId = String(deploymentId || randomUUID()).replace(/[^a-z0-9-]/gi, "").slice(0, 18) || randomUUID().slice(0, 8);
  const releasesRoot = join(config.runtimeDir, "releases");
  mkdirSync(releasesRoot, { recursive: true });
  const candidateRoot = resolve(releasesRoot, `${shortCommit}-${safeId}`);
  const releasesPrefix = `${resolve(releasesRoot).toLowerCase()}${process.platform === "win32" ? "\\" : "/"}`;
  if (!candidateRoot.toLowerCase().startsWith(releasesPrefix)) {
    throw new Error("Release candidate path escaped the service release directory.");
  }
  if (isSamePath(candidateRoot, config.dataDir) || isSamePath(candidateRoot, config.uploadsDir)) {
    throw new Error("Release candidate path must not overlap data/uploads.");
  }
  return candidateRoot;
}

function assertReleaseCandidateSafe(config, validationRoot, validationConfig) {
  if (!sameVolume(config.root, validationRoot)) {
    throw new Error("Release candidate must be created on the same volume as the target service root.");
  }
  const forbidden = [
    validationConfig.dataDir,
    validationConfig.uploadsDir,
    join(validationRoot, ".env.local"),
    join(validationRoot, ".runtime", "staging.env"),
    join(validationRoot, ".runtime", "production.env"),
  ];
  for (const path of forbidden) {
    if (existsSync(path)) throw new Error(`Release candidate contains forbidden runtime state: ${path}`);
  }
}

function buildVerificationEnv(baseEnv, options = {}) {
  const env = {
    ...baseEnv,
    npm_config_production: "false",
  };
  if (options.includeRuntimeConfig !== true) {
    delete env.NODE_ENV;
    delete env.PORT;
    delete env.STAGING_PORT;
    delete env.PRODUCTION_PORT;
    delete env.STAGING_SMOKE_PORT;
    delete env.DATA_DIR;
    delete env.UPLOADS_DIR;
    delete env.AOHUANG_ALLOW_RUNTIME_DIR_OVERRIDE;
  }
  return env;
}

async function findTemporaryPort() {
  for (let port = 43107; port < 43200; port += 1) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error("No temporary staging smoke port is available.");
}

export async function rollbackService(service, options = {}) {
  const config = getServiceConfig(service, options);
  if (!options.backupDir) throw new Error("rollback requires --backup.");
  if (!options.commit) throw new Error("rollback requires --commit.");
  const runtime = buildRuntimeEnv(service, { root: config.root });
  if (runtime.missing.length) {
    throw new Error(`Missing required runtime configuration before rollback: ${runtime.missing.join(", ")}`);
  }
  const rollbackEnv = options.env || runtime.env;
  const previousActiveRelease = readActiveRelease(config, { optional: true });
  let operationLock = null;
  const manifest = verifyBackupManifest(config, options.backupDir);
  const deploymentId = options.deploymentId || manifest.deploymentId;
  const restoreOptions = { ...options, deploymentId };
  try {
    operationLock = await acquireServiceOperationLock(config, "rollback", { deploymentId, backupDir: options.backupDir }, { existingLock: options.operationLock });
    runSync("git", ["cat-file", "-e", `${options.commit}^{commit}`], { cwd: config.root });
    if (options.mode === "full") prepareDatabaseRestore(config, manifest, rollbackEnv, restoreOptions);
  } catch (error) {
    releaseServiceOperationLock(operationLock);
    throw error;
  }
  const originalCommit = safeGit(config.root, ["rev-parse", "HEAD"], "unknown");
  const prepared = await prepareRollbackCodeCandidate(service, config, runtime, options.commit);
  let restoredDirectories = null;
  let keepFailedLock = false;
  try {
    await stopService(service, { root: config.root });
    runSync("git", ["checkout", "--detach", options.commit], { cwd: config.root });
    writeActiveRelease(config, {
      releaseRoot: prepared.root,
      runtimeCommit: options.commit,
      deploymentId,
    });
    await startService(service, { root: config.root, preflightOnly: true });
    if (options.mode === "full") {
      restoredDirectories = restoreDataAndUploads(config, options.backupDir, { deferCleanup: true });
      touchServiceOperationLock(operationLock);
      await restoreDatabaseBackup(config, manifest, rollbackEnv, {
        ...restoreOptions,
        onProgress: () => touchServiceOperationLock(operationLock),
      });
      touchServiceOperationLock(operationLock);
    }
    await startService(service, { root: config.root });
    const health = await checkServiceHealth(service, { root: config.root, repeat: 10 });
    if (!health.ok) throw new Error(`${service} rollback health check failed.`);
    cleanupRestoredDirectories(restoredDirectories);
    return health;
  } catch (error) {
    markServiceOperationFailed(config, operationLock, error);
    keepFailedLock = true;
    rollbackRestoredDirectories(restoredDirectories);
    await stopService(service, { root: config.root }).catch(() => null);
    restoreActiveRelease(config, previousActiveRelease);
    if (originalCommit !== "unknown") {
      runSync("git", ["checkout", "--detach", originalCommit], { cwd: config.root, allowStatus: [0, 128] });
    }
    throw error;
  } finally {
    if (!keepFailedLock) releaseServiceOperationLock(operationLock);
  }
}

async function prepareRollbackCodeCandidate(service, config, runtime, commit) {
  const candidateRoot = createReleaseCandidateRoot(config, commit, `rollback-${process.pid}`);
  runSync("git", ["worktree", "add", "--detach", candidateRoot, commit], { cwd: config.root });
  try {
    const verificationEnv = buildVerificationEnv(runtime.env, { includeRuntimeConfig: false });
    for (const [command, args] of rollbackCandidateCommands) {
      await run(command, args, { cwd: candidateRoot, env: verificationEnv });
    }
    await run(process.execPath, ["scripts/ops/start-service.mjs", service, "--preflight-only", "--root", candidateRoot], {
      cwd: candidateRoot,
      env: runtime.env,
    });
    const smokeConfig = getServiceConfig(service, { root: candidateRoot, port: config.port });
    await run("npm", ["run", "test:staging-smoke"], {
      cwd: candidateRoot,
      env: {
        ...runtime.env,
        AOHUANG_ALLOW_RUNTIME_DIR_OVERRIDE: "1",
        DATA_DIR: join(smokeConfig.runtimeDir, "rollback-smoke-data"),
        UPLOADS_DIR: join(smokeConfig.runtimeDir, "rollback-smoke-uploads"),
        STAGING_SMOKE_PORT: String(await findTemporaryPort()),
      },
    });
    return { root: candidateRoot };
  } catch (error) {
    throw error;
  }
}

// Deprecated legacy same-root activation path. Immutable release deploys must not call this helper.
export function activatePreparedArtifacts(config, prepared, label, options = {}) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
  const rename = options.rename || renameSync;
  const renameOptions = {
    rename,
    attempts: options.renameAttempts,
    delayMs: options.renameDelayMs,
  };
  const state = { root: config.root, moved: [], renameOptions };
  try {
    for (const name of ["node_modules", ".next"]) {
      const source = join(prepared.root, name);
      if (!existsSync(source)) throw new Error(`Prepared rollback artifact is missing: ${name}`);
      assertPreparedArtifact(name, source);
      assertSameVolume(source, join(config.root, name), options);
    }
    for (const name of ["node_modules", ".next"]) {
      const source = join(prepared.root, name);
      const target = join(config.root, name);
      const old = `${target}.before-${label}-${stamp}`;
      const entry = { name, source, target, old: null, activated: false };
      if (existsSync(target)) {
        renameWithRetry(target, old, renameOptions);
        entry.old = old;
      }
      state.moved.push(entry);
      renameWithRetry(source, target, renameOptions);
      entry.activated = true;
      assertPreparedArtifact(name, target);
    }
    assertActivatedArtifactSet(config.root);
  } catch (error) {
    rollbackPreparedArtifacts(state);
    throw error;
  }
  return state;
}

export async function waitForStoppedServiceArtifacts(config, options = {}) {
  const timeoutMs = options.timeoutMs || 20_000;
  const intervalMs = options.intervalMs || 500;
  const startedAt = Date.now();
  let lastReason = "";
  do {
    if (!await isPortAvailable(config.port)) {
      lastReason = `port ${config.port} is still in use`;
    } else {
      const probe = probeArtifactWritable(config, options);
      if (probe.ok) return true;
      lastReason = probe.reason;
    }
    await wait(intervalMs);
  } while (Date.now() - startedAt < timeoutMs);
  throw new Error(`${config.service} did not release service artifacts after stop: ${lastReason}`);
}

function probeArtifactWritable(config, options = {}) {
  const rename = options.rename || renameSync;
  for (const name of ["node_modules", ".next"]) {
    const target = join(config.root, name);
    if (!existsSync(target)) continue;
    const probe = `${target}.release-probe-${process.pid}-${Date.now()}`;
    try {
      rename(target, probe);
      rename(probe, target);
    } catch (error) {
      if (!existsSync(target) && existsSync(probe)) {
        try {
          rename(probe, target);
        } catch (restoreError) {
          throw new Error(`Artifact release probe could not restore ${name}: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`);
        }
      }
      return { ok: false, reason: `${name}: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
  return { ok: true };
}

function rollbackPreparedArtifacts(state) {
  for (const entry of [...(state?.moved || [])].reverse()) {
    if (entry.target && existsSync(entry.target) && (entry.activated || entry.old)) {
      rmSync(entry.target, { recursive: true, force: true });
    }
    if (entry.old && existsSync(entry.old)) renameWithRetry(entry.old, entry.target, state?.renameOptions);
  }
  if (state?.moved?.length) assertActivatedArtifactSet(state.root);
}

function renameWithRetry(source, target, options = {}) {
  const rename = options?.rename || renameSync;
  const attempts = Number.isFinite(options?.attempts)
    ? Number(options.attempts)
    : (process.platform === "win32" ? 60 : 1);
  const delayMs = Number.isFinite(options?.delayMs)
    ? Number(options.delayMs)
    : (process.platform === "win32" ? 500 : 0);
  for (let attempt = 1; attempt <= Math.max(1, attempts); attempt += 1) {
    try {
      return rename(source, target);
    } catch (error) {
      if (attempt >= Math.max(1, attempts) || !isRetryableRenameError(error)) throw error;
      sleepSync(delayMs);
    }
  }
}

function isRetryableRenameError(error) {
  return ["EPERM", "EBUSY", "EACCES", "ENOTEMPTY"].includes(error?.code);
}

function sleepSync(ms) {
  if (!ms || ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function assertPreparedArtifact(name, path) {
  const files = countFiles(path);
  if (files <= 0) throw new Error(`Prepared artifact is empty: ${name}`);
  if (name === "node_modules" && !existsSync(join(path, "next", "dist", "bin", "next"))) {
    throw new Error("Prepared node_modules is missing Next.js binary.");
  }
  if (name === "node_modules" && !existsSync(join(path, "@next", "env", "package.json"))) {
    throw new Error("Prepared node_modules is missing @next/env.");
  }
  if (name === ".next") {
    for (const keyFile of ["BUILD_ID", "required-server-files.json"]) {
      if (!existsSync(join(path, keyFile))) throw new Error(`Prepared .next is missing ${keyFile}.`);
    }
    for (const keyDir of ["server", "static"]) {
      if (!existsSync(join(path, keyDir)) || !statSync(join(path, keyDir)).isDirectory()) {
        throw new Error(`Prepared .next is missing ${keyDir}.`);
      }
    }
  }
}

function assertActivatedArtifactSet(root) {
  assertPreparedArtifact("node_modules", join(root, "node_modules"));
  assertPreparedArtifact(".next", join(root, ".next"));
}

function countFiles(path) {
  if (!existsSync(path)) return 0;
  const stats = statSync(path);
  if (stats.isFile()) return 1;
  if (!stats.isDirectory()) return 0;
  let total = 0;
  for (const entry of readdirSync(path)) {
    total += countFiles(join(path, entry));
  }
  return total;
}

function assertSameVolume(source, target, options = {}) {
  if (!sameVolume(source, target, options)) {
    throw new Error(`Prepared artifact must be on the same volume as the target: ${source} -> ${target}`);
  }
}

export function sameVolume(left, right, options = {}) {
  const volumeProvider = options.volumeProvider || defaultVolume;
  return volumeProvider(left) === volumeProvider(right);
}

function defaultVolume(path) {
  if (process.platform === "win32") return parse(resolve(path)).root.toLowerCase();
  return "/";
}

function isSamePath(left, right) {
  return resolve(left).toLowerCase() === resolve(right).toLowerCase();
}

function assertCleanWorktree(root) {
  const status = runSync("git", ["status", "--porcelain"], { cwd: root }).stdout.trim();
  if (status) throw new Error("Working tree must be clean before deployment.");
}

function checkDiskSpace(root) {
  if (process.platform !== "win32") return;
  const drive = root.slice(0, 2);
  const result = runSync("powershell.exe", ["-NoProfile", "-Command", `(Get-PSDrive -Name '${drive[0]}').Free`]);
  const free = Number(result.stdout.trim());
  if (Number.isFinite(free) && free < 1024 * 1024 * 1024) {
    throw new Error("Less than 1GB free disk space; refusing deployment.");
  }
}

function assertNoDataLoss(before, after) {
  for (const key of ["data", "uploads"]) {
    if (after[key].count < before[key].count) {
      throw new Error(`${key} file count decreased from ${before[key].count} to ${after[key].count}.`);
    }
    if (before[key].sha256 && after[key].sha256 && before[key].sha256 !== after[key].sha256) {
      throw new Error(`${key} checksum changed during deployment.`);
    }
  }
}

async function cli() {
  const service = process.argv[2];
  const targetIndex = process.argv.indexOf("--target");
  const rootIndex = process.argv.indexOf("--root");
  const dryRun = process.argv.includes("--dry-run");
  const target = targetIndex >= 0 ? process.argv[targetIndex + 1] : undefined;
  const root = rootIndex >= 0 ? process.argv[rootIndex + 1] : undefined;
  const report = await deployService(service, { root, target, dryRun });
  console.log(JSON.stringify(report, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  cli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    if (error.report) console.error(JSON.stringify(error.report, null, 2));
    process.exit(1);
  });
}
