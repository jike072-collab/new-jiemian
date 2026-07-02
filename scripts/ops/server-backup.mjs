#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createDatabaseBackup, detectDatabase } from "./database-backup.mjs";
import { safeGit } from "./git-utils.mjs";
import { getServiceConfig } from "./service-config.mjs";
import {
  acquireServiceOperationLock,
  markServiceOperationFailed,
  releaseServiceOperationLock,
} from "./operation-lock.mjs";

export const SERVER_BACKUP_MANIFEST = "server-backup-manifest.json";
export const SERVER_BACKUP_CHECKSUMS = "checksums.json";
export const SERVER_BACKUP_KIND = "server-expiring-media-policy";
const DEFAULT_RETENTION_COUNT = 5;
const MIN_RETENTION_COUNT = 3;
const MAX_RETENTION_COUNT = 7;
const METADATA_EXTENSIONS = new Set([".json", ".jsonl"]);
const SKIPPED_DIRS = new Set([".cache", ".tmp", "cache", "logs", "runtime", "temp", "tmp", "uploads"]);
const SENSITIVE_ENV_PATTERN = /(PASSWORD|SECRET|TOKEN|KEY|COOKIE|AUTHORIZATION|DATABASE_URL|ACCESS_TOKEN|API_KEY)/i;

export async function createServerBackup(service = "production", options = {}) {
  const env = options.env || process.env;
  const config = resolveServerBackupConfig(service, options, env);
  const retention = resolveRetentionCount(env.SERVER_BACKUP_RETENTION_COUNT || env.LOCAL_BACKUP_RETENTION_COUNT);
  const plan = buildBackupPlan(config, env, retention);
  if (options.apply !== true) {
    return {
      ok: true,
      mode: "dry-run",
      service: config.service,
      backupRoot: config.backupRoot,
      plannedBackupName: plan.name,
      database: plan.database,
      dataMetadataFiles: plan.dataMetadataFiles.length,
      migrationFiles: plan.migrationFiles.length,
      retentionCount: retention,
      uploadsBackedUp: false,
    };
  }

  if (config.service === "production" && plan.database.type === "none" && options.allowNoDatabase !== true) {
    throw new Error("APP_DATABASE_URL is required for a production server backup.");
  }

  assertBackupRootSafe(config);
  mkdirPrivate(config.backupRoot);

  let operationLock = null;
  let tempDir = null;
  try {
    operationLock = await acquireServiceOperationLock(config, "backup", {
      backupRoot: config.backupRoot,
      backupName: plan.name,
    });

    const finalDir = join(config.backupRoot, plan.name);
    tempDir = join(config.backupRoot, `.${plan.name}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`);
    if (existsSync(finalDir)) throw new Error("Backup target already exists; refusing to overwrite.");
    if (existsSync(tempDir)) throw new Error("Temporary backup directory already exists; refusing to overwrite.");
    mkdirPrivate(tempDir);

    const databaseBackup = createDatabaseBackup(config, {
      backupDir: tempDir,
      env,
      ...(options.databaseOptions || {}),
    });
    copyDataMetadata(config, tempDir);
    copyMigrationFiles(config, tempDir);

    const artifactChecksums = checksumBackupArtifacts(tempDir);
    const manifest = buildManifest(config, env, plan, databaseBackup, artifactChecksums, retention);
    const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
    assertNoSensitiveText(manifestText, env);
    writePrivateFile(join(tempDir, SERVER_BACKUP_MANIFEST), manifestText);
    writePrivateFile(join(tempDir, SERVER_BACKUP_CHECKSUMS), `${JSON.stringify(artifactChecksums, null, 2)}\n`);
    chmodTreePrivate(tempDir);
    verifyServerBackupManifest(tempDir, { expectedService: config.service });
    renameSync(tempDir, finalDir);
    tempDir = null;
    return {
      ok: true,
      mode: "apply",
      service: config.service,
      backupDir: finalDir,
      manifest: join(finalDir, SERVER_BACKUP_MANIFEST),
      checksumFile: join(finalDir, SERVER_BACKUP_CHECKSUMS),
      artifactCount: artifactChecksums.length,
      artifactSizeBytes: artifactChecksums.reduce((total, item) => total + item.size, 0),
      retentionCount: retention,
      uploadsBackedUp: false,
    };
  } catch (error) {
    const safeError = new Error(safeErrorMessage(error, env));
    markServiceOperationFailed(config, operationLock, safeError);
    throw safeError;
  } finally {
    if (tempDir && existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
    releaseServiceOperationLock(operationLock);
  }
}

export function pruneServerBackups(service = "production", options = {}) {
  const env = options.env || process.env;
  const config = resolveServerBackupConfig(service, options, env);
  const keep = resolveRetentionCount(options.keep || env.SERVER_BACKUP_RETENTION_COUNT || env.LOCAL_BACKUP_RETENTION_COUNT);
  assertBackupRootSafe(config);
  if (!existsSync(config.backupRoot)) {
    return { ok: true, mode: options.apply === true ? "apply" : "dry-run", service: config.service, backupRoot: config.backupRoot, keep, candidates: [] };
  }
  const backups = listServerBackups(config)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const candidates = backups.slice(keep);
  if (options.apply === true) {
    for (const candidate of candidates) {
      assertControlledBackupDelete(config, candidate.path);
      rmSync(candidate.path, { recursive: true, force: true });
    }
  }
  return {
    ok: true,
    mode: options.apply === true ? "apply" : "dry-run",
    service: config.service,
    backupRoot: config.backupRoot,
    keep,
    scanned: backups.length,
    deleted: options.apply === true ? candidates.length : 0,
    candidates: candidates.map((entry) => ({
      name: basename(entry.path),
      createdAt: entry.createdAt,
      sizeBytes: entry.sizeBytes,
    })),
  };
}

export function verifyServerBackupManifest(backupDir, options = {}) {
  const root = resolve(backupDir);
  const manifestPath = join(root, SERVER_BACKUP_MANIFEST);
  const checksumsPath = join(root, SERVER_BACKUP_CHECKSUMS);
  if (!existsSync(manifestPath)) throw new Error("Server backup manifest is missing.");
  if (!existsSync(checksumsPath)) throw new Error("Server backup checksum file is missing.");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.kind !== SERVER_BACKUP_KIND) throw new Error("Unsupported server backup kind.");
  if (options.expectedService && manifest.serviceName !== options.expectedService) {
    throw new Error("Server backup belongs to a different service.");
  }
  if (manifest.uploadsBackedUp !== false) throw new Error("Server backup manifest must not mark expiring uploads as backed up.");
  const checksums = JSON.parse(readFileSync(checksumsPath, "utf8"));
  for (const entry of checksums) {
    const target = resolve(root, entry.path);
    if (!isInsideOrSame(root, target)) throw new Error("Server backup checksum path escapes backup root.");
    if (!existsSync(target)) throw new Error(`Server backup file is missing: ${entry.path}`);
    const stats = statSync(target);
    if (stats.size !== entry.size) throw new Error(`Server backup file size mismatch: ${entry.path}`);
    if (hashFile(target) !== entry.sha256) throw new Error(`Server backup checksum mismatch: ${entry.path}`);
  }
  return { manifest, checksums };
}

export function resolveServerBackupConfig(service = "production", options = {}, env = process.env) {
  const base = getServiceConfig(service, options);
  const dataDir = resolve(env.DATA_DIR || options.dataDir || base.dataDir);
  const uploadsDir = resolve(env.UPLOADS_DIR || options.uploadsDir || base.uploadsDir);
  const runtimeDir = resolve(env.RUNTIME_DIR || options.runtimeDir || base.runtimeDir);
  const backupRoot = resolve(
    options.backupRoot
      || env.SERVER_BACKUP_ROOT
      || env.AOHUANG_BACKUP_ROOT
      || join(dirname(dataDir), "backups"),
  );
  return {
    ...base,
    dataDir,
    uploadsDir,
    runtimeDir,
    backupRoot,
  };
}

function buildBackupPlan(config, env, retentionCount) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
  const name = `server-${config.service}-${stamp}-${randomUUID().slice(0, 8)}`;
  return {
    name,
    database: safeDatabasePlan(env),
    dataMetadataFiles: discoverDataMetadataFiles(config.dataDir),
    migrationFiles: discoverMigrationFiles(config.root),
    retentionCount,
  };
}

function safeDatabasePlan(env) {
  const database = detectDatabase(env);
  if (database.type !== "postgres") return { type: database.type };
  const url = new URL(database.url);
  return {
    type: "postgres",
    databaseName: decodeURIComponent(url.pathname.replace(/^\//, "")),
    hostCategory: normalizeHost(url.hostname),
    port: url.port || "5432",
    usernameHash: hashText(decodeURIComponent(url.username || "")),
  };
}

function buildManifest(config, env, plan, databaseBackup, checksums, retentionCount) {
  const pkg = readPackage(config.root);
  const dataArtifacts = checksums.filter((entry) => entry.path.startsWith("data/"));
  const migrationArtifacts = checksums.filter((entry) => entry.path.startsWith("migrations/"));
  const createdAt = new Date().toISOString();
  return {
    backupVersion: 1,
    kind: SERVER_BACKUP_KIND,
    createdAt,
    serviceName: config.service,
    runtimePort: config.port,
    sourceCommit: safeGit(config.root, ["rev-parse", "HEAD"], "unknown"),
    sourceBranch: safeGit(config.root, ["branch", "--show-current"], "unknown"),
    packageName: pkg.name || null,
    packageVersion: pkg.version || null,
    nodeVersion: process.version,
    backupPolicy: {
      localRetentionCount: retentionCount,
      localCopyPurpose: "short-term database and metadata copy for a 60GB single server",
      offHostCopyRecommended: true,
      mediaRetentionHours: env.MEDIA_RETENTION_HOURS || "24",
    },
    scope: {
      includesPostgres: databaseBackup.type === "postgres",
      includesDataMetadata: true,
      includesProviderConfig: dataArtifacts.some((entry) => entry.path === "data/providers.json"),
      includesMigrations: migrationArtifacts.length > 0,
      includesUploads: false,
      excludesExpiringGeneratedMedia: true,
      excludesTemporaryUploads: true,
      excludesCache: true,
      excludesLogs: true,
    },
    uploadsBackedUp: false,
    databaseBackup: sanitizeDatabaseBackup(databaseBackup, checksums),
    dataMetadata: summarizeArtifacts(dataArtifacts),
    schemaMigrations: summarizeArtifacts(migrationArtifacts),
    schemaVersion: {
      migrationFileCount: migrationArtifacts.length,
      latestMigrationFile: migrationArtifacts.at(-1)?.path || null,
      migrationFilesSha256: hashText(JSON.stringify(migrationArtifacts.map((entry) => [entry.path, entry.size, entry.sha256]))),
      databaseMigrationState: databaseBackup.type === "postgres" ? "included-in-postgres-dump" : "not-applicable",
    },
    checksumsFile: SERVER_BACKUP_CHECKSUMS,
    artifacts: checksums,
    artifactCount: checksums.length,
    artifactSizeBytes: checksums.reduce((total, item) => total + item.size, 0),
  };
}

function sanitizeDatabaseBackup(databaseBackup, checksums) {
  const databaseArtifacts = checksums.filter((entry) => entry.path.startsWith("database/"));
  if (!databaseBackup || databaseBackup.type !== "postgres") {
    return {
      type: databaseBackup?.type || "none",
      required: Boolean(databaseBackup?.required),
      files: databaseArtifacts,
    };
  }
  return {
    type: "postgres",
    required: Boolean(databaseBackup.required),
    format: databaseBackup.format,
    databaseName: databaseBackup.databaseName,
    hostCategory: normalizeHost(databaseBackup.host),
    port: databaseBackup.port,
    usernameHash: hashText(databaseBackup.user || ""),
    fingerprint: databaseBackup.fingerprint,
    pgDumpVersion: databaseBackup.pgDumpVersion || null,
    pgRestoreVersion: databaseBackup.pgRestoreVersion || null,
    files: databaseArtifacts,
  };
}

function summarizeArtifacts(artifacts) {
  return {
    count: artifacts.length,
    sizeBytes: artifacts.reduce((total, item) => total + item.size, 0),
    sha256: hashText(JSON.stringify(artifacts.map((entry) => [entry.path, entry.size, entry.sha256]))),
    files: artifacts.map((entry) => entry.path),
  };
}

function copyDataMetadata(config, backupDir) {
  const targetRoot = join(backupDir, "data");
  for (const file of discoverDataMetadataFiles(config.dataDir)) {
    const relativePath = toManifestPath(relative(config.dataDir, file));
    copyPrivateFile(file, join(targetRoot, relativePath));
  }
}

function copyMigrationFiles(config, backupDir) {
  const migrationsRoot = join(config.root, "db", "migrations");
  const targetRoot = join(backupDir, "migrations");
  for (const file of discoverMigrationFiles(config.root)) {
    const relativePath = toManifestPath(relative(migrationsRoot, file));
    copyPrivateFile(file, join(targetRoot, relativePath));
  }
}

function discoverDataMetadataFiles(dataDir) {
  if (!existsSync(dataDir)) return [];
  return listFiles(dataDir)
    .filter((file) => METADATA_EXTENSIONS.has(extname(file).toLowerCase()))
    .filter((file) => !basename(file).endsWith(".tmp"))
    .sort();
}

function discoverMigrationFiles(root) {
  const migrationsRoot = join(root, "db", "migrations");
  if (!existsSync(migrationsRoot)) return [];
  return listFiles(migrationsRoot)
    .filter((file) => extname(file).toLowerCase() === ".sql")
    .sort();
}

function listFiles(root) {
  const results = [];
  if (!existsSync(root)) return results;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const fullPath = join(root, entry.name);
    const stats = lstatSync(fullPath);
    if (stats.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name.toLowerCase())) continue;
      results.push(...listFiles(fullPath));
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }
  return results;
}

function checksumBackupArtifacts(backupDir) {
  return listFiles(backupDir)
    .filter((file) => ![SERVER_BACKUP_MANIFEST, SERVER_BACKUP_CHECKSUMS].includes(basename(file)))
    .map((file) => ({
      path: toManifestPath(relative(backupDir, file)),
      size: statSync(file).size,
      sha256: hashFile(file),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function listServerBackups(config) {
  if (!existsSync(config.backupRoot)) return [];
  const prefix = `server-${config.service}-`;
  const results = [];
  for (const entry of readdirSync(config.backupRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith(prefix)) continue;
    const backupPath = join(config.backupRoot, entry.name);
    try {
      const { manifest, checksums } = verifyServerBackupManifest(backupPath, { expectedService: config.service });
      results.push({
        path: backupPath,
        createdAt: manifest.createdAt || statSync(backupPath).mtime.toISOString(),
        sizeBytes: checksums.reduce((total, item) => total + item.size, 0),
      });
    } catch {
      // Unknown or corrupt directories are never pruned automatically.
    }
  }
  return results;
}

function assertBackupRootSafe(config) {
  const backupRoot = resolve(config.backupRoot);
  if (!isAbsolute(backupRoot)) throw new Error("Backup root must be an absolute path.");
  for (const [label, forbidden] of [
    ["release root", config.root],
    ["data directory", config.dataDir],
    ["uploads directory", config.uploadsDir],
    ["runtime directory", config.runtimeDir],
  ]) {
    const resolved = resolve(forbidden);
    if (samePath(backupRoot, resolved) || isInsideOrSame(resolved, backupRoot) || isInsideOrSame(backupRoot, resolved)) {
      throw new Error(`Backup root must not overlap the ${label}.`);
    }
  }
}

function assertControlledBackupDelete(config, target) {
  const backupRoot = resolve(config.backupRoot);
  const resolved = resolve(target);
  if (!isInsideOrSame(backupRoot, resolved) || samePath(backupRoot, resolved)) {
    throw new Error("Refusing to delete outside the controlled backup root.");
  }
  if (!basename(resolved).startsWith(`server-${config.service}-`)) {
    throw new Error("Refusing to delete an unknown backup directory.");
  }
}

function resolveRetentionCount(raw) {
  const value = Number(raw || DEFAULT_RETENTION_COUNT);
  if (!Number.isInteger(value)) return DEFAULT_RETENTION_COUNT;
  if (value < MIN_RETENTION_COUNT || value > MAX_RETENTION_COUNT) return DEFAULT_RETENTION_COUNT;
  return value;
}

function normalizeHost(hostname) {
  const value = String(hostname || "").toLowerCase();
  if (["localhost", "127.0.0.1", "::1", "[::1]"].includes(value)) return "loopback";
  return "remote";
}

function readPackage(root) {
  try {
    return JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  } catch {
    return {};
  }
}

function mkdirPrivate(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodBestEffort(path, 0o700);
}

function copyPrivateFile(source, target) {
  mkdirPrivate(dirname(target));
  copyFileSync(source, target);
  chmodBestEffort(target, 0o600);
}

function writePrivateFile(path, text) {
  mkdirPrivate(dirname(path));
  const fd = openSync(path, "w", 0o600);
  try {
    writeFileSync(fd, text);
  } finally {
    closeSync(fd);
  }
  chmodBestEffort(path, 0o600);
}

function chmodTreePrivate(root) {
  if (!existsSync(root)) return;
  chmodBestEffort(root, 0o700);
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) chmodTreePrivate(fullPath);
    else if (entry.isFile()) chmodBestEffort(fullPath, 0o600);
  }
}

function chmodBestEffort(path, mode) {
  try {
    chmodSync(path, mode);
  } catch {
    // Windows and restricted filesystems may not honor POSIX modes.
  }
}

function hashFile(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function hashText(text) {
  return createHash("sha256").update(String(text)).digest("hex");
}

function toManifestPath(value) {
  return String(value).replace(/\\/g, "/");
}

function samePath(left, right) {
  return resolve(left).toLowerCase() === resolve(right).toLowerCase();
}

function isInsideOrSame(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (Boolean(rel) && !rel.startsWith("..") && !isAbsolute(rel));
}

function secretCandidates(env) {
  return Object.entries(env)
    .filter(([key, value]) => SENSITIVE_ENV_PATTERN.test(key) && typeof value === "string" && value.length >= 6)
    .map(([, value]) => value);
}

function assertNoSensitiveText(text, env) {
  for (const secret of secretCandidates(env)) {
    if (text.includes(secret)) throw new Error("Server backup manifest contains a sensitive value.");
  }
  if (/postgres(?:ql)?:\/\/[^"\s]+/i.test(text)) throw new Error("Server backup manifest contains a database URL.");
}

function safeErrorMessage(error, env = process.env) {
  let text = String(error instanceof Error ? error.message : error)
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "postgresql://[REDACTED]")
    .replace(/(password|token|secret|key)=([^&\s]+)/gi, "$1=[REDACTED]");
  for (const secret of secretCandidates(env)) {
    text = text.split(secret).join("[REDACTED]");
  }
  return text;
}

function parseArgs(args) {
  const options = {
    service: "production",
    apply: false,
    prune: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--dry-run") options.apply = false;
    else if (arg === "--prune") options.prune = true;
    else if (arg === "--service") options.service = args[++index];
    else if (arg === "--root") options.root = args[++index];
    else if (arg === "--backup-root") options.backupRoot = args[++index];
    else if (arg === "--keep") options.keep = args[++index];
    else if (arg === "--allow-no-database") options.allowNoDatabase = true;
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
    "  node scripts/ops/server-backup.mjs --dry-run",
    "  node scripts/ops/server-backup.mjs --apply",
    "  node scripts/ops/server-backup.mjs --prune --dry-run",
    "  node scripts/ops/server-backup.mjs --prune --apply",
    "",
    "Creates short-term PostgreSQL and data-metadata backups for the single 3106 server.",
    "Generated media in uploads is intentionally not backed up by this policy.",
  ].join("\n"));
}

async function cli() {
  const options = parseArgs(process.argv.slice(2));
  const result = options.prune
    ? pruneServerBackups(options.service, options)
    : await createServerBackup(options.service, options);
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  cli().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      code: "server_backup_failed",
      message: safeErrorMessage(error),
    }, null, 2));
    process.exit(1);
  });
}
