import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { createDatabaseFingerprint } from "./database-backup.mjs";
import { runSync } from "./process-utils.mjs";

const DEFAULT_RESTORE_AUTH_TTL_MS = 15 * 60 * 1000;

export function createDatabaseRestoreAuthorization(config, manifest, env = process.env, options = {}) {
  const database = manifest.databaseBackup || { type: manifest.databaseType || "none" };
  if (database.type !== "postgres") {
    return { type: database.type, required: false };
  }
  const createdAt = new Date();
  const ttlMs = options.ttlMs || DEFAULT_RESTORE_AUTH_TTL_MS;
  return {
    type: "postgres",
    purpose: "deploy-failure-full-rollback",
    deploymentId: options.deploymentId,
    serviceName: config.service,
    backupDir: resolve(manifest.backupDir || options.backupDir || ""),
    backupManifestHash: hashBackupManifest(manifest.backupDir || options.backupDir),
    sourceCommit: options.sourceCommit || manifest.sourceCommit || manifest.commit,
    targetCommit: options.targetCommit,
    databaseFingerprint: createDatabaseFingerprint(config, env),
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + ttlMs).toISOString(),
    used: false,
  };
}

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
  verifyDatabaseRestoreAuthorization(config, manifest, env, options, { consume: false });
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
  verifyDatabaseRestoreAuthorization(config, manifest, env, options, { consume: true });
  const pgRestore = commandSpec(options.pgRestoreCommand || options.pgRestorePath || "pg_restore");
  runSync(pgRestore.command, [
    ...pgRestore.args,
    "--clean",
    "--if-exists",
    "--single-transaction",
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

export function hashBackupManifest(backupDir) {
  if (!backupDir) throw new Error("Backup directory is required for manifest hash.");
  const manifestPath = resolve(backupDir, "backup-manifest.json");
  if (!existsSync(manifestPath)) throw new Error("Rollback backup manifest is missing.");
  return createHash("sha256").update(readFileSync(manifestPath)).digest("hex");
}

function verifyDatabaseRestoreAuthorization(config, manifest, env, options, verifyOptions = {}) {
  const authorization = options.rollbackAuthorization;
  if (!authorization || authorization.type !== "postgres") {
    throw new Error("PostgreSQL full restore requires deployment-scoped rollback authorization.");
  }
  if (authorization.used) {
    throw new Error("PostgreSQL restore authorization has already been used.");
  }
  if (authorization.purpose !== "deploy-failure-full-rollback") {
    throw new Error("PostgreSQL restore authorization purpose is invalid.");
  }
  if (authorization.serviceName !== config.service) {
    throw new Error("PostgreSQL restore authorization service does not match.");
  }
  if (resolve(authorization.backupDir) !== resolve(manifest.backupDir)) {
    throw new Error("PostgreSQL restore authorization backup directory does not match.");
  }
  if (authorization.backupManifestHash !== hashBackupManifest(manifest.backupDir)) {
    throw new Error("PostgreSQL restore authorization manifest hash does not match.");
  }
  const manifestCommit = manifest.sourceCommit || manifest.commit;
  if (authorization.sourceCommit && manifestCommit && authorization.sourceCommit !== manifestCommit) {
    throw new Error("PostgreSQL restore authorization source commit does not match.");
  }
  if (options.expectedTargetCommit && authorization.targetCommit !== options.expectedTargetCommit) {
    throw new Error("PostgreSQL restore authorization target commit does not match.");
  }
  const currentFingerprint = createDatabaseFingerprint(config, env);
  if (!sameFingerprint(authorization.databaseFingerprint, currentFingerprint)) {
    throw new Error("PostgreSQL restore target database fingerprint does not match authorization.");
  }
  if (!sameFingerprint(manifest.databaseBackup?.fingerprint, currentFingerprint)) {
    throw new Error("PostgreSQL restore target database fingerprint does not match the backup manifest.");
  }
  const expiresAt = Date.parse(authorization.expiresAt || "");
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
    throw new Error("PostgreSQL restore authorization has expired.");
  }
  if (verifyOptions.consume) authorization.used = true;
}

function sameFingerprint(left, right) {
  return Boolean(left?.sha256 && right?.sha256 && left.sha256 === right.sha256);
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
