#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
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
import { acquireServiceOperationLock, markServiceOperationFailed, releaseServiceOperationLock } from "./operation-lock.mjs";

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
  let releaseArtifacts = null;
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
    operationLock = acquireServiceOperationLock(config, "deploy", { deploymentId, target });
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
      await stopService(service, { root: config.root });
      serviceStopped = true;
      await wait(1500);
      runSync("git", ["checkout", "--detach", targetCommit], { cwd: config.root });
      releaseArtifacts = activatePreparedArtifacts(config, preparedRelease, "release");
      report.releaseArtifacts = releaseArtifacts.moved.map((entry) => entry.name);
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
      cleanupPreparedArtifacts(releaseArtifacts);
      releaseArtifacts = null;
    }
    report.success = true;
    return report;
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
    if (!options.dryRun && serviceStopped) {
      await rollbackService(service, {
        root: config.root,
        backupDir: backup.backupDir,
        commit: before.commit,
        mode: "full",
        env: runtime.env,
        rollbackAuthorization,
        deploymentId,
        expectedTargetCommit: targetCommit,
        operationLock,
      });
      report.rollbackTriggered = true;
      cleanupPreparedArtifacts(releaseArtifacts);
      releaseArtifacts = null;
    }
    throw Object.assign(new Error(report.error), { report });
  } finally {
    if (releaseArtifacts) rollbackPreparedArtifacts(releaseArtifacts);
    if (preparedRelease?.root) cleanupValidationWorktree(config.root, preparedRelease.root);
    releaseServiceOperationLock(operationLock);
    mkdirSync(config.runtimeDir, { recursive: true });
    writeFileSync(join(config.runtimeDir, `deploy-${service}-last.json`), JSON.stringify(report, null, 2));
  }
}

async function validateTargetInWorktree(service, config, runtime, targetCommit, report) {
  const validationRoot = mkdtempSync(join(tmpdir(), `aohuang-${service}-deploy-check-`));
  report.validationRoot = validationRoot;
  try {
    runSync("git", ["worktree", "add", "--detach", validationRoot, targetCommit], { cwd: config.root });
    const validationConfig = getServiceConfig(service, { root: validationRoot, port: config.port });
    const verificationEnv = buildVerificationEnv(process.env, { includeRuntimeConfig: false });
    const smokeEnv = {
      ...buildVerificationEnv(runtime.env, { includeRuntimeConfig: true }),
      AOHUANG_ALLOW_RUNTIME_DIR_OVERRIDE: "1",
      DATA_DIR: validationConfig.dataDir,
      UPLOADS_DIR: validationConfig.uploadsDir,
      STAGING_SMOKE_PORT: String(await findTemporaryPort()),
    };
    for (const [command, args] of validationCheckCommands) {
      const commandEnv = command === "npm" && args.join(" ") === "run test:staging-smoke" ? smokeEnv : verificationEnv;
      await run(command, args, { cwd: validationRoot, env: commandEnv });
      report.checks.push({ command: `validation ${command} ${args.join(" ")}`, ok: true });
    }
    await run(process.execPath, ["scripts/ops/start-service.mjs", service, "--preflight-only", "--root", validationRoot], {
      cwd: validationRoot,
      env: { ...runtime.env, DATA_DIR: smokeEnv.DATA_DIR, UPLOADS_DIR: smokeEnv.UPLOADS_DIR },
    });
    report.checks.push({ command: "validation start-service --preflight-only", ok: true });
    return { root: validationRoot };
  } catch (error) {
    cleanupValidationWorktree(config.root, validationRoot);
    throw error;
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

function cleanupValidationWorktree(repoRoot, validationRoot) {
  runSync("git", ["worktree", "remove", "--force", validationRoot], {
    cwd: repoRoot,
    allowStatus: [0, 128],
  });
  if (existsSync(validationRoot)) rmSync(validationRoot, { recursive: true, force: true });
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
  let operationLock = null;
  const manifest = verifyBackupManifest(config, options.backupDir);
  const deploymentId = options.deploymentId || manifest.deploymentId;
  const restoreOptions = { ...options, deploymentId };
  try {
    operationLock = acquireServiceOperationLock(config, "rollback", { deploymentId, backupDir: options.backupDir }, { existingLock: options.operationLock });
    runSync("git", ["cat-file", "-e", `${options.commit}^{commit}`], { cwd: config.root });
    if (options.mode === "full") prepareDatabaseRestore(config, manifest, rollbackEnv, restoreOptions);
  } catch (error) {
    releaseServiceOperationLock(operationLock);
    throw error;
  }
  const originalCommit = safeGit(config.root, ["rev-parse", "HEAD"], "unknown");
  const prepared = await prepareRollbackCodeCandidate(service, config, runtime, options.commit);
  let artifacts = null;
  let restoredDirectories = null;
  let keepFailedLock = false;
  try {
    await stopService(service, { root: config.root });
    await wait(1500);
    if (!await isPortAvailable(config.port)) throw new Error(`${service} port ${config.port} did not stop cleanly.`);
    runSync("git", ["checkout", "--detach", options.commit], { cwd: config.root });
    artifacts = activatePreparedArtifacts(config, prepared, "rollback");
    await startService(service, { root: config.root, preflightOnly: true });
    if (options.mode === "full") {
      restoredDirectories = restoreDataAndUploads(config, options.backupDir, { deferCleanup: true });
      restoreDatabaseBackup(config, manifest, rollbackEnv, restoreOptions);
    }
    await startService(service, { root: config.root });
    const health = await checkServiceHealth(service, { root: config.root, repeat: 10 });
    if (!health.ok) throw new Error(`${service} rollback health check failed.`);
    cleanupRestoredDirectories(restoredDirectories);
    cleanupPreparedArtifacts(artifacts);
    return health;
  } catch (error) {
    markServiceOperationFailed(config, operationLock, error);
    keepFailedLock = true;
    rollbackRestoredDirectories(restoredDirectories);
    rollbackPreparedArtifacts(artifacts);
    if (originalCommit !== "unknown") {
      runSync("git", ["checkout", "--detach", originalCommit], { cwd: config.root, allowStatus: [0, 128] });
    }
    throw error;
  } finally {
    if (!keepFailedLock) releaseServiceOperationLock(operationLock);
    cleanupValidationWorktree(config.root, prepared.root);
  }
}

async function prepareRollbackCodeCandidate(service, config, runtime, commit) {
  mkdirSync(config.backupRoot, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
  const candidateRoot = join(config.backupRoot, `${config.backupPrefix}-rollback-code-${stamp}-${process.pid}`);
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
    cleanupValidationWorktree(config.root, candidateRoot);
    throw error;
  }
}

function activatePreparedArtifacts(config, prepared, label) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
  const state = { moved: [] };
  try {
    for (const name of ["node_modules", ".next"]) {
      const source = join(prepared.root, name);
      const target = join(config.root, name);
      if (!existsSync(source)) throw new Error(`Prepared rollback artifact is missing: ${name}`);
      const old = `${target}.before-${label}-${stamp}`;
      let oldPath = null;
      if (existsSync(target)) {
        renameSync(target, old);
        oldPath = old;
      }
      try {
        renameSync(source, target);
      } catch (error) {
        if (oldPath && existsSync(oldPath)) renameSync(oldPath, target);
        throw error;
      }
      state.moved.push({ name, source, target, old: oldPath });
    }
  } catch (error) {
    rollbackPreparedArtifacts(state);
    throw error;
  }
  return state;
}

function cleanupPreparedArtifacts(state) {
  for (const entry of state?.moved || []) {
    if (entry.old && existsSync(entry.old)) rmSync(entry.old, { recursive: true, force: true });
  }
}

function rollbackPreparedArtifacts(state) {
  for (const entry of [...(state?.moved || [])].reverse()) {
    if (entry.target && existsSync(entry.target)) rmSync(entry.target, { recursive: true, force: true });
    if (entry.old && existsSync(entry.old)) renameSync(entry.old, entry.target);
  }
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
