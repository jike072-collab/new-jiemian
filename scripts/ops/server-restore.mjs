#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveServerBackupConfig, verifyServerBackupManifest } from "./server-backup.mjs";

export function verifyServerRestorePlan(service = "production", options = {}) {
  if (!options.backupDir) throw new Error("Restore verification requires --backup.");
  const env = options.env || process.env;
  const config = resolveServerBackupConfig(service, options, env);
  const { manifest, checksums } = verifyServerBackupManifest(options.backupDir, { expectedService: config.service });
  return {
    ok: true,
    mode: "verify",
    service: config.service,
    backupDir: resolve(options.backupDir),
    createdAt: manifest.createdAt,
    sourceCommit: manifest.sourceCommit,
    database: manifest.databaseBackup?.type || "none",
    dataMetadataFiles: manifest.dataMetadata?.count || 0,
    migrationFiles: manifest.schemaMigrations?.count || 0,
    artifactCount: checksums.length,
    uploadsBackedUp: false,
    nextSteps: [
      "stop application writes",
      "verify manifest and checksums",
      "restore PostgreSQL dump when present",
      "restore data metadata files",
      "repair file permissions",
      "start service",
      "run safe health and functional acceptance checks",
    ],
  };
}

export function restoreServerBackup(service = "production", options = {}) {
  const plan = verifyServerRestorePlan(service, options);
  if (options.apply !== true) return plan;
  if (options.confirmRestore !== true) throw new Error("Restore apply requires --confirm-restore.");
  if (options.confirmWritesStopped !== true) throw new Error("Restore apply requires --confirm-writes-stopped.");
  if (service === "production" && options.allowProductionRestore !== true) {
    throw new Error("Production restore requires --allow-production-restore.");
  }

  const env = options.env || process.env;
  const config = resolveServerBackupConfig(service, options, env);
  const { manifest } = verifyServerBackupManifest(options.backupDir, { expectedService: config.service });
  const restored = [];
  if (manifest.databaseBackup?.type === "postgres") {
    restored.push(restorePostgresDump(config, manifest, options.backupDir, env, options));
  }
  for (const file of manifest.artifacts.filter((entry) => entry.path.startsWith("data/"))) {
    const source = resolve(options.backupDir, file.path);
    const target = join(config.dataDir, file.path.slice("data/".length));
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
    restored.push({ type: "data-metadata", path: file.path });
  }
  return {
    ...plan,
    mode: "apply",
    restored,
  };
}

function restorePostgresDump(config, manifest, backupDir, env, options = {}) {
  const databaseUrl = env.APP_DATABASE_URL || "";
  if (!/^postgres(?:ql)?:\/\//i.test(databaseUrl)) {
    throw new Error("APP_DATABASE_URL must be PostgreSQL before restore.");
  }
  const fileEntry = manifest.databaseBackup.files?.[0];
  if (!fileEntry?.path) throw new Error("PostgreSQL dump is missing from the manifest.");
  const dump = resolve(backupDir, fileEntry.path);
  if (!existsSync(dump)) throw new Error("PostgreSQL dump file is missing.");
  const url = new URL(databaseUrl);
  const targetDatabase = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (manifest.databaseBackup.databaseName && manifest.databaseBackup.databaseName !== targetDatabase) {
    throw new Error("PostgreSQL restore target database does not match the backup manifest.");
  }
  const pgRestore = commandSpec(options.pgRestoreCommand || "pg_restore");
  const result = spawnSync(pgRestore.command, [
    ...pgRestore.args,
    "--clean",
    "--if-exists",
    "--single-transaction",
    "--no-owner",
    "--dbname",
    targetDatabase,
    "--host",
    url.hostname,
    "--port",
    url.port || "5432",
    "--username",
    decodeURIComponent(url.username),
    dump,
  ], {
    env: {
      ...env,
      PGPASSWORD: decodeURIComponent(url.password || ""),
    },
    encoding: "utf8",
    shell: false,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "pg_restore failed.");
  return { type: "postgres", file: basename(dump) };
}

function commandSpec(command) {
  if (Array.isArray(command)) return { command: command[0], args: command.slice(1) };
  return { command, args: [] };
}

function parseArgs(args) {
  const options = { service: "production", apply: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--backup") options.backupDir = args[++index];
    else if (arg === "--service") options.service = args[++index];
    else if (arg === "--root") options.root = args[++index];
    else if (arg === "--backup-root") options.backupRoot = args[++index];
    else if (arg === "--verify" || arg === "--dry-run") options.apply = false;
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--confirm-restore") options.confirmRestore = true;
    else if (arg === "--confirm-writes-stopped") options.confirmWritesStopped = true;
    else if (arg === "--allow-production-restore") options.allowProductionRestore = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unsupported argument: ${arg}`);
    }
  }
  return options;
}

function printHelp() {
  console.log([
    "Usage:",
    "  node scripts/ops/server-restore.mjs --backup <backup-dir> --verify",
    "  node scripts/ops/server-restore.mjs --backup <backup-dir> --apply --confirm-restore --confirm-writes-stopped --allow-production-restore",
    "",
    "Verify is the default. Apply mode is intentionally gated and must be run only after writes are stopped.",
  ].join("\n"));
}

async function cli() {
  const options = parseArgs(process.argv.slice(2));
  const result = restoreServerBackup(options.service, options);
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  cli().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      code: "server_restore_failed",
      message: String(error instanceof Error ? error.message : error)
        .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "postgresql://[REDACTED]"),
    }, null, 2));
    process.exit(1);
  });
}
