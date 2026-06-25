import { existsSync } from "node:fs";
import { basename } from "node:path";
import { runSync } from "./process-utils.mjs";

export function prepareDatabaseRestore(config, manifest, env = process.env, options = {}) {
  const database = manifest.databaseBackup || { type: manifest.databaseType || "none" };
  if (database.type === "none" || database.type === "sqlite" || database.type === "unknown") {
    return { type: database.type, required: false, ready: true, restored: false };
  }
  if (database.type !== "postgres") throw new Error(`Unsupported database restore type: ${database.type}`);
  assertBackupBelongsToService(config, manifest);
  const dump = database.files?.[0];
  if (!dump || !existsSync(dump)) throw new Error("PostgreSQL restore dump file is missing.");
  const pgRestore = commandSpec(options.pgRestoreCommand || options.pgRestorePath || "pg_restore");
  runSync(pgRestore.command, [...pgRestore.args, "--list", dump], { env });
  const allowed = options.allowDestructive === true || env.AOHUANG_ALLOW_DATABASE_RESTORE === "1";
  if (!allowed) {
    throw new Error("PostgreSQL full restore requires AOHUANG_ALLOW_DATABASE_RESTORE=1 or explicit allowDestructive option.");
  }
  return { type: "postgres", required: true, ready: true, restored: false, dump: basename(dump) };
}

export function restoreDatabaseBackup(config, manifest, env = process.env, options = {}) {
  const prepared = prepareDatabaseRestore(config, manifest, env, options);
  if (prepared.type !== "postgres") return prepared;
  const database = manifest.databaseBackup;
  const dump = database.files[0];
  const databaseUrl = env.APP_DATABASE_URL;
  if (!databaseUrl || !/^postgres(?:ql)?:\/\//i.test(databaseUrl)) {
    throw new Error("APP_DATABASE_URL must be PostgreSQL before database restore.");
  }
  const url = new URL(databaseUrl);
  const expectedDb = database.databaseName;
  const targetDb = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (expectedDb && expectedDb !== targetDb) {
    throw new Error("PostgreSQL restore target database does not match the backup manifest.");
  }
  const pgRestore = commandSpec(options.pgRestoreCommand || options.pgRestorePath || "pg_restore");
  runSync(pgRestore.command, [
    ...pgRestore.args,
    "--clean",
    "--if-exists",
    "--no-owner",
    "--dbname",
    targetDb,
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
  });
  return { ...prepared, restored: true };
}

function assertBackupBelongsToService(config, manifest) {
  if ((manifest.serviceName || manifest.service) !== config.service) {
    throw new Error("Database restore backup belongs to a different service.");
  }
}

function commandSpec(command) {
  if (Array.isArray(command)) return { command: command[0], args: command.slice(1) };
  return { command, args: [] };
}
