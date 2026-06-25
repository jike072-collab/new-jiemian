#!/usr/bin/env node
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createServiceBackup, snapshotDirectory, writeRollbackScript } from "./backup-utils.mjs";
import { buildRuntimeEnv } from "./load-runtime-env.mjs";
import { getServiceConfig } from "./service-config.mjs";
import { checkServiceHealth } from "./health-check.mjs";
import { startService } from "./start-service.mjs";
import { stopService } from "./stop-service.mjs";
import { getListeningPid, isPortAvailable, run, runSync, wait } from "./process-utils.mjs";

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

const serviceRefreshCommands = [
  ["npm", ["ci"]],
  ["npm", ["run", "build"]],
];

export async function deployService(service, options = {}) {
  const config = getServiceConfig(service, options);
  const target = options.target || "origin/main";
  let serviceStopped = false;
  const before = {
    pid: getListeningPid(config.port),
    commit: safeGit(config.root, ["rev-parse", "HEAD"]),
    data: snapshotDirectory(config.dataDir),
    uploads: snapshotDirectory(config.uploadsDir),
  };
  const report = {
    service,
    root: config.root,
    port: config.port,
    target,
    startedAt: new Date().toISOString(),
    before,
    backup: null,
    rollback: null,
    checks: [],
    success: false,
  };

  assertCleanWorktree(config.root);
  runSync("git", ["fetch", "origin"], { cwd: config.root });
  const targetCommit = runSync("git", ["rev-parse", target], { cwd: config.root }).stdout.trim();
  report.targetCommit = targetCommit;
  checkDiskSpace(config.root);

  const runtime = buildRuntimeEnv(service, { root: config.root });
  if (runtime.missing.length) {
    throw new Error(`Missing required runtime configuration before stopping old process: ${runtime.missing.join(", ")}`);
  }

  await validateTargetInWorktree(service, config, runtime, targetCommit, report);

  const backup = createServiceBackup(config, { note: `before deploy to ${targetCommit}` });
  const rollbackScript = writeRollbackScript(config, backup, before.commit);
  report.backup = backup.backupDir;
  report.rollback = rollbackScript;

  try {
    if (!options.dryRun) {
      stopService(service, { root: config.root });
      serviceStopped = true;
      await wait(1500);
      runSync("git", ["checkout", "--detach", targetCommit], { cwd: config.root });
      for (const [command, args] of serviceRefreshCommands) {
        await run(command, args, { cwd: config.root, env: buildVerificationEnv(runtime.env, { includeRuntimeConfig: true }) });
        report.checks.push({ command: `service ${command} ${args.join(" ")}`, ok: true });
      }
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
      await rollbackService(service, { root: config.root, backupDir: backup.backupDir, commit: before.commit });
      report.rollbackTriggered = true;
    }
    throw Object.assign(new Error(report.error), { report });
  } finally {
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
    await run(process.execPath, ["scripts/ops/start-service.mjs", service, "--preflight-only"], {
      cwd: validationRoot,
      env: { ...runtime.env, DATA_DIR: smokeEnv.DATA_DIR, UPLOADS_DIR: smokeEnv.UPLOADS_DIR },
    });
    report.checks.push({ command: "validation start-service --preflight-only", ok: true });
  } finally {
    cleanupValidationWorktree(config.root, validationRoot);
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
  stopService(service, { root: config.root });
  await wait(1500);
  runSync("git", ["checkout", "--detach", options.commit], { cwd: config.root });
  await run("npm", ["ci"], { cwd: config.root });
  await run("npm", ["run", "build"], { cwd: config.root });
  if (options.backupDir) {
    const dataBackup = join(options.backupDir, "data");
    const uploadsBackup = join(options.backupDir, "uploads");
    if (!existsSync(dataBackup) || !existsSync(uploadsBackup)) {
      throw new Error("Rollback backup is missing data or uploads snapshot.");
    }
  }
  await startService(service, { root: config.root });
  const health = await checkServiceHealth(service, { root: config.root, repeat: 10 });
  if (!health.ok) throw new Error(`${service} rollback health check failed.`);
  return health;
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
  }
}

function safeGit(root, args) {
  try {
    return runSync("git", args, { cwd: root }).stdout.trim();
  } catch {
    return "";
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
