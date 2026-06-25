import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { runSync } from "./process-utils.mjs";

export function detectDatabase(env = process.env) {
  const value = env.APP_DATABASE_URL || "";
  if (!value) return { type: "none" };
  if (/^postgres(?:ql)?:\/\//i.test(value)) return { type: "postgres", url: value };
  if (/^file:/i.test(value) || /\.(sqlite|sqlite3|db)$/i.test(value)) return { type: "sqlite", url: value };
  return { type: "unknown" };
}

export function createDatabaseBackup(config, options = {}) {
  const env = options.env || process.env;
  const database = detectDatabase(env);
  const backupDir = options.backupDir;
  if (!backupDir) throw new Error("backupDir is required for database backup.");
  const databaseDir = join(backupDir, "database");
  mkdirSync(databaseDir, { recursive: true });

  if (database.type === "none") return { type: "none", required: false, files: [] };
  if (database.type === "unknown") {
    if (config.service === "production") throw new Error("Unknown database type; refusing production backup.");
    return { type: "unknown", required: false, files: [] };
  }
  if (database.type === "sqlite") {
    return { type: "sqlite", required: false, files: [] };
  }
  return createPostgresBackup(config, database.url, databaseDir, env, options);
}

function createPostgresBackup(config, databaseUrl, databaseDir, env, options = {}) {
  const url = new URL(databaseUrl);
  const output = join(databaseDir, `${config.service}-postgres.dump`);
  const pgDump = commandSpec(options.pgDumpCommand || options.pgDumpPath || "pg_dump");
  const pgRestore = commandSpec(options.pgRestoreCommand || options.pgRestorePath || "pg_restore");
  const pgDumpVersion = runSync(pgDump.command, [...pgDump.args, "--version"]).stdout.trim();
  const pgRestoreVersion = runSync(pgRestore.command, [...pgRestore.args, "--version"]).stdout.trim();
  const args = [
    "--format=custom",
    "--file",
    output,
    "--host",
    url.hostname,
    "--port",
    url.port || "5432",
    "--username",
    decodeURIComponent(url.username),
    "--dbname",
    decodeURIComponent(url.pathname.replace(/^\//, "")),
  ];
  runSync(pgDump.command, [...pgDump.args, ...args], {
    env: {
      ...env,
      PGPASSWORD: decodeURIComponent(url.password || ""),
    },
  });
  if (!existsSync(output)) throw new Error("PostgreSQL backup file was not created.");
  runSync(pgRestore.command, [...pgRestore.args, "--list", output], {
    env: {
      ...env,
      PGPASSWORD: decodeURIComponent(url.password || ""),
    },
  });
  return {
    type: "postgres",
    required: config.service === "production",
    files: [output],
    format: "custom",
    pgDumpVersion,
    pgRestoreVersion,
    databaseName: decodeURIComponent(url.pathname.replace(/^\//, "")),
    host: url.hostname,
    port: url.port || "5432",
    user: decodeURIComponent(url.username),
  };
}

function commandSpec(command) {
  if (Array.isArray(command)) return { command: command[0], args: command.slice(1) };
  return { command, args: [] };
}
