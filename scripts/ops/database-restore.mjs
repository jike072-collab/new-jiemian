import { createHash, randomUUID } from "node:crypto";
import { existsSync, renameSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { createDatabaseFingerprint } from "./database-backup.mjs";
import { runSync } from "./process-utils.mjs";

const DEFAULT_RESTORE_AUTH_TTL_MS = 15 * 60 * 1000;
const RESTORE_AUTH_VERSION = 1;
const AUTH_PENDING = "rollback-authorization.pending.json";
const AUTH_CONSUMING = "rollback-authorization.consuming.json";
const AUTH_USED = "rollback-authorization.used.json";

export function createDatabaseRestoreAuthorization(config, manifest, env = process.env, options = {}) {
  const database = manifest.databaseBackup || { type: manifest.databaseType || "none" };
  if (database.type !== "postgres") {
    return { type: database.type, required: false };
  }
  if (!options.deploymentId) throw new Error("deploymentId is required for PostgreSQL rollback authorization.");
  const createdAt = new Date();
  const ttlMs = options.ttlMs || DEFAULT_RESTORE_AUTH_TTL_MS;
  const authorization = {
    authorizationVersion: RESTORE_AUTH_VERSION,
    authorizationId: options.authorizationId || randomUUID(),
    type: "postgres",
    purpose: "deploy-failure-full-rollback",
    deploymentId: options.deploymentId,
    serviceName: config.service,
    environment: config.service,
    backupDir: resolve(manifest.backupDir || options.backupDir || ""),
    backupManifestHash: hashBackupManifest(manifest.backupDir || options.backupDir),
    sourceCommit: options.sourceCommit || manifest.sourceCommit || manifest.commit,
    targetCommit: options.targetCommit,
    databaseFingerprint: createDatabaseFingerprint(config, env),
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + ttlMs).toISOString(),
    nonce: options.nonce || randomUUID(),
    used: false,
  };
  return attachAuthorizationSignature(authorization);
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
  const consumedAuthorization = claimDatabaseRestoreAuthorization(config, manifest, env, options);
  try {
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
    markAuthorizationUsed(consumedAuthorization, "restored");
    return { ...prepared, restored: true };
  } catch (error) {
    markAuthorizationUsed(consumedAuthorization, "failed", error instanceof Error ? error.message : String(error));
    throw error;
  }
}

export function hashBackupManifest(backupDir) {
  if (!backupDir) throw new Error("Backup directory is required for manifest hash.");
  const manifestPath = resolve(backupDir, "backup-manifest.json");
  if (!existsSync(manifestPath)) throw new Error("Rollback backup manifest is missing.");
  return createHash("sha256").update(readFileSync(manifestPath)).digest("hex");
}

function verifyDatabaseRestoreAuthorization(config, manifest, env, options, verifyOptions = {}) {
  const authorization = loadAuthorization(config, manifest, options);
  if (!authorization || authorization.type !== "postgres") {
    throw new Error("PostgreSQL full restore requires deployment-scoped rollback authorization.");
  }
  assertAuthorizationSignature(authorization);
  if (authorization.authorizationVersion !== RESTORE_AUTH_VERSION) {
    throw new Error("PostgreSQL restore authorization version is invalid.");
  }
  if (!authorization.authorizationId) {
    throw new Error("PostgreSQL restore authorization id is missing.");
  }
  if (authorization.__state === "consuming") {
    throw new Error("PostgreSQL restore authorization is currently being consumed.");
  }
  if (authorization.__state === "used" || authorization.used) {
    throw new Error("PostgreSQL restore authorization has already been used.");
  }
  if (authorization.purpose !== "deploy-failure-full-rollback") {
    throw new Error("PostgreSQL restore authorization purpose is invalid.");
  }
  const deploymentId = options.deploymentId || authorization.deploymentId || manifest.deploymentId;
  if (!authorization.deploymentId || !manifest.deploymentId) {
    throw new Error("PostgreSQL restore requires deploymentId in manifest, authorization, and restore context.");
  }
  if (deploymentId && authorization.deploymentId !== deploymentId) {
    throw new Error("PostgreSQL restore authorization deploymentId does not match.");
  }
  if (authorization.deploymentId !== manifest.deploymentId) {
    throw new Error("PostgreSQL restore authorization deploymentId does not match manifest.");
  }
  if (authorization.serviceName !== config.service) {
    throw new Error("PostgreSQL restore authorization service does not match.");
  }
  if (authorization.environment !== config.service) {
    throw new Error("PostgreSQL restore authorization environment does not match.");
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
  if (!verifyOptions.consume) return authorization;
  return claimDatabaseRestoreAuthorization(config, manifest, env, options, authorization);
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

export function writeDatabaseRestoreAuthorizationFile(config, manifest, authorization) {
  if (!authorization || authorization.type !== "postgres") return null;
  const signed = attachAuthorizationSignature({ ...authorization, used: false });
  const file = join(resolve(manifest.backupDir), AUTH_PENDING);
  writeFileSync(file, JSON.stringify(signed, null, 2), { flag: "wx" });
  return file;
}

export function readDatabaseRestoreAuthorizationFile(file) {
  const authorization = JSON.parse(readFileSync(file, "utf8"));
  return { ...authorization, __path: resolve(file) };
}

export function defaultAuthorizationPath(backupDir) {
  return join(resolve(backupDir), AUTH_PENDING);
}

function loadAuthorization(config, manifest, options) {
  if (options.rollbackAuthorizationFile) return readDatabaseRestoreAuthorizationFile(options.rollbackAuthorizationFile);
  if (options.rollbackAuthorization) return options.rollbackAuthorization;
  const defaultPath = defaultAuthorizationPath(manifest.backupDir);
  const consumingPath = join(resolve(manifest.backupDir || ""), AUTH_CONSUMING);
  const usedPath = join(resolve(manifest.backupDir || ""), AUTH_USED);
  if (existsSync(defaultPath)) return { ...readDatabaseRestoreAuthorizationFile(defaultPath), __state: "pending" };
  if (existsSync(consumingPath)) return { ...readDatabaseRestoreAuthorizationFile(consumingPath), __state: "consuming" };
  if (existsSync(usedPath)) return { ...readDatabaseRestoreAuthorizationFile(usedPath), __state: "used" };
  return null;
}

function claimDatabaseRestoreAuthorization(config, manifest, env, options, authorization = null) {
  const verified = authorization || verifyDatabaseRestoreAuthorization(config, manifest, env, options, { consume: false });
  if (verified.__path) {
    const pending = verified.__path;
    if (!pending.endsWith(AUTH_PENDING)) {
      throw new Error("PostgreSQL restore authorization file must be pending before use.");
    }
    const consuming = pending.replace(AUTH_PENDING, AUTH_CONSUMING);
    renameSync(pending, consuming);
    return { ...verified, __path: consuming, __consumingPath: consuming, __state: "consuming" };
  }
  verified.__state = "consuming";
  return verified;
}

function markAuthorizationUsed(authorization, status, error) {
  const finished = attachAuthorizationSignature({
    ...withoutPrivateFields(authorization),
    used: true,
    consumedAt: new Date().toISOString(),
    consumeStatus: status,
    error: error ? String(error).slice(0, 500) : undefined,
  });
  if (!authorization?.__consumingPath) {
    Object.assign(authorization, finished, { __state: "used" });
    return authorization;
  }
  const usedPath = authorization.__consumingPath.replace(AUTH_CONSUMING, AUTH_USED);
  writeFileSync(authorization.__consumingPath, JSON.stringify(finished, null, 2));
  renameSync(authorization.__consumingPath, usedPath);
  return { ...authorization, __path: usedPath, __state: "used", used: true };
}

function attachAuthorizationSignature(authorization) {
  const unsigned = withoutPrivateFields({ ...authorization });
  delete unsigned.signature;
  return { ...unsigned, signature: signatureFor(unsigned) };
}

function assertAuthorizationSignature(authorization) {
  const unsigned = withoutPrivateFields({ ...authorization });
  const signature = unsigned.signature;
  delete unsigned.signature;
  if (!signature || signature !== signatureFor(unsigned)) {
    throw new Error("PostgreSQL restore authorization signature is invalid.");
  }
}

function signatureFor(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function withoutPrivateFields(value) {
  return Object.fromEntries(Object.entries(value).filter(([key, entry]) => !key.startsWith("__") && entry !== undefined));
}
