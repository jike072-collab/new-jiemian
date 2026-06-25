import { createHash, randomUUID } from "node:crypto";
import { closeSync, copyFileSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { createDatabaseBackup } from "./database-backup.mjs";
import { safeGit } from "./git-utils.mjs";

export function snapshotDirectory(path) {
  if (!existsSync(path)) return { path, exists: false, count: 0, size: 0, latestUtc: null, sha256: null };
  const files = listFiles(path);
  let size = 0;
  let latest = 0;
  const hash = createHash("sha256");
  for (const file of files) {
    const stats = statSync(file);
    const relativePath = toManifestPath(relative(path, file));
    size += stats.size;
    latest = Math.max(latest, stats.mtimeMs);
    hash.update(relativePath);
    hash.update("\0");
    hash.update(hashFile(file));
    hash.update("\0");
    hash.update(String(stats.size));
    hash.update("\0");
  }
  return {
    path,
    exists: true,
    count: files.length,
    size,
    latestUtc: latest ? new Date(latest).toISOString() : null,
    sha256: hash.digest("hex"),
  };
}

export function createServiceBackup(config, options = {}) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
  const backupDir = join(config.backupRoot, `${config.backupPrefix}-${stamp}`);
  const deploymentId = options.deploymentId || randomUUID();
  mkdirSync(backupDir, { recursive: true });

  for (const entry of [
    ["data", config.dataDir],
    ["uploads", config.uploadsDir],
  ]) {
    const [name, source] = entry;
    if (existsSync(source)) cpSync(source, join(backupDir, name), { recursive: true, force: true });
  }

  for (const source of config.envFilePaths) {
    if (existsSync(source)) {
      const targetName = basename(source).startsWith(".env") ? basename(source) : source.replace(config.root, "").replace(/[\\/:*?"<>|]/g, "_");
      copyFileSync(source, join(backupDir, targetName));
    }
  }

  for (const sourceName of ["package.json", "package-lock.json"]) {
    const source = join(config.root, sourceName);
    if (existsSync(source)) copyFileSync(source, join(backupDir, sourceName));
  }

  const dbDir = join(backupDir, "db-files");
  mkdirSync(dbDir, { recursive: true });
  const dbFiles = listFiles(config.root)
    .filter((file) => /\.(sqlite|sqlite3|db)$/i.test(file) || file.includes(`${config.root}\\database\\`));
  for (const file of dbFiles) {
    const target = join(dbDir, relative(config.root, file).replace(/[\\/:*?"<>|]/g, "_"));
    copyFileSync(file, target);
  }
  const database = createDatabaseBackup(config, {
    backupDir,
    env: options.env || process.env,
    ...(options.databaseOptions || {}),
  });

  const meta = {
    backupVersion: 2,
    deploymentId,
    createdAt: new Date().toISOString(),
    serviceName: config.service,
    service: config.service,
    backupDir,
    root: config.root,
    sourceCommit: safeGit(config.root, ["rev-parse", "HEAD"], "unknown"),
    commit: safeGit(config.root, ["rev-parse", "HEAD"], "unknown"),
    branch: safeGit(config.root, ["branch", "--show-current"]),
    dataDir: config.dataDir,
    uploadsDir: config.uploadsDir,
    data: snapshotDirectory(config.dataDir),
    uploads: snapshotDirectory(config.uploadsDir),
    databaseType: database.type,
    databaseBackup: database,
    envBackups: config.envFilePaths.filter((file) => existsSync(file)).map((file) => basename(file)),
    startCommand: `node scripts/ops/start-service.mjs ${config.service}`,
    toolVersions: {
      node: process.version,
      pgDump: database.pgDumpVersion || null,
      pgRestore: database.pgRestoreVersion || null,
    },
    verified: false,
    dbFileCount: dbFiles.length,
    note: options.note || "service backup",
  };
  writeFileSync(join(backupDir, "backup-meta.json"), JSON.stringify(meta, null, 2));
  const checksums = checksumFiles(backupDir);
  writeFileSync(join(backupDir, "backup-manifest.json"), JSON.stringify({ ...meta, verified: true, checksumsFile: "checksums.json" }, null, 2));
  writeFileSync(join(backupDir, "checksums.json"), JSON.stringify(checksumFiles(backupDir), null, 2));
  return { backupDir, meta, checksums };
}

export function writeRollbackScript(config, backup, targetCommit, options = {}) {
  const authFile = options.rollbackAuthorizationFile || join(backup.backupDir, "rollback-authorization.pending.json");
  const deploymentId = options.deploymentId || backup.meta?.deploymentId || "";
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$root = '${config.root.replace(/'/g, "''")}'`,
    `$backup = '${backup.backupDir.replace(/'/g, "''")}'`,
    `$commit = '${targetCommit}'`,
    `$authorization = '${authFile.replace(/'/g, "''")}'`,
    `$deploymentId = '${deploymentId.replace(/'/g, "''")}'`,
    "Set-Location -LiteralPath $root",
    `node scripts/ops/rollback-service.mjs ${config.service} --root $root --backup $backup --commit $commit --mode full --rollback-authorization-file $authorization --deployment-id $deploymentId`,
  ].join("\r\n");
  const rollbackPath = join(backup.backupDir, `rollback-${config.service}.ps1`);
  writeFileSync(rollbackPath, `\uFEFF${script}`, "utf8");
  return rollbackPath;
}

export function verifyBackupManifest(config, backupDir) {
  const manifestPath = join(backupDir, "backup-manifest.json");
  const checksumsPath = join(backupDir, "checksums.json");
  if (!existsSync(manifestPath)) throw new Error("Rollback backup manifest is missing.");
  if (!existsSync(checksumsPath)) throw new Error("Rollback checksum file is missing.");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if ((manifest.serviceName || manifest.service) !== config.service) throw new Error("Rollback backup belongs to a different service.");
  if (manifest.backupVersion !== 2) throw new Error("Unsupported backup manifest version.");
  if (!manifest.deploymentId) throw new Error("Rollback backup deploymentId is missing.");
  for (const entry of JSON.parse(readFileSync(checksumsPath, "utf8"))) {
    const file = join(backupDir, entry.path);
    if (!existsSync(file)) throw new Error(`Rollback checksum target is missing: ${entry.path}`);
    const actual = hashFile(file);
    if (actual !== entry.sha256) throw new Error(`Rollback checksum mismatch: ${entry.path}`);
    if (typeof entry.size === "number" && statSync(file).size !== entry.size) {
      throw new Error(`Rollback checksum size mismatch: ${entry.path}`);
    }
  }
  return manifest;
}

export function restoreDataAndUploads(config, backupDir, options = {}) {
  verifyBackupManifest(config, backupDir);
  const checksums = readBackupChecksums(backupDir);
  const restored = [];
  const prepared = [];
  try {
    prepared.push(restoreDirectory(join(backupDir, "data"), config.dataDir, {
      backupDir,
      checksums,
      prefix: "data",
      stageOnly: true,
    }));
    prepared.push(restoreDirectory(join(backupDir, "uploads"), config.uploadsDir, {
      backupDir,
      checksums,
      prefix: "uploads",
      stageOnly: true,
    }));
    for (const entry of prepared) {
      restored.push(commitRestoredDirectory(entry, { deferCleanup: Boolean(options.deferCleanup) }));
    }
    return { backupDir, restored };
  } catch (error) {
    rollbackRestoredDirectories({ restored: [...restored, ...prepared] });
    throw error;
  }
}

export function checksumFiles(root) {
  return listFiles(root).filter((file) => !["checksums.json"].includes(relative(root, file))).map((file) => ({
    path: toManifestPath(relative(root, file)),
    size: statSync(file).size,
    sha256: hashFile(file),
  }));
}

export function cleanupRestoredDirectories(restoreState) {
  for (const entry of restoreState?.restored || []) {
    if (entry.old && existsSync(entry.old)) rmSync(entry.old, { recursive: true, force: true });
  }
}

export function rollbackRestoredDirectories(restoreState) {
  for (const entry of [...(restoreState?.restored || [])].reverse()) {
    if (entry.target && existsSync(entry.target)) rmSync(entry.target, { recursive: true, force: true });
    if (entry.old && existsSync(entry.old)) renameSync(entry.old, entry.target);
    if (entry.temp && existsSync(entry.temp)) rmSync(entry.temp, { recursive: true, force: true });
  }
}

function listFiles(root) {
  if (!existsSync(root)) return [];
  const results = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) results.push(...listFiles(fullPath));
    else if (entry.isFile()) results.push(fullPath);
  }
  return results;
}

function restoreDirectory(source, target, options = {}) {
  if (!existsSync(source)) throw new Error(`Rollback source directory is missing: ${source}`);
  mkdirSync(dirname(target), { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
  const temp = `${target}.restore-${stamp}`;
  cpSync(source, temp, { recursive: true, force: true });
  try {
    verifyRestoredDirectory(source, temp, options);
  } catch (error) {
    rmSync(temp, { recursive: true, force: true });
    throw error;
  }
  if (options.stageOnly) {
    return { source, target, old: null, temp, staged: true };
  }
  return commitRestoredDirectory({ source, target, old: null, temp, staged: true }, options);
}

function commitRestoredDirectory(state, options = {}) {
  const { target, temp } = state;
  const old = `${target}.old-${new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-")}`;
  if (existsSync(target)) renameSync(target, old);
  try {
    renameSync(temp, target);
    const committed = { source: state.source, target, old: existsSync(old) ? old : null, temp: null };
    if (!options.deferCleanup && committed.old && existsSync(committed.old)) {
      rmSync(committed.old, { recursive: true, force: true });
    }
    return committed;
  } catch (error) {
    if (existsSync(target)) rmSync(target, { recursive: true, force: true });
    if (existsSync(old)) renameSync(old, target);
    if (existsSync(temp)) rmSync(temp, { recursive: true, force: true });
    throw error;
  }
}

function verifyRestoredDirectory(source, temp, options) {
  const prefix = options.prefix;
  const expected = new Map(
    (options.checksums || [])
      .filter((entry) => manifestPathStartsWith(entry.path, prefix))
      .map((entry) => [stripManifestPrefix(entry.path, prefix), entry]),
  );
  const sourceFiles = listFiles(source).map((file) => toManifestPath(relative(source, file))).sort();
  const tempFiles = listFiles(temp).map((file) => toManifestPath(relative(temp, file))).sort();
  if (sourceFiles.length !== tempFiles.length || sourceFiles.some((file, index) => file !== tempFiles[index])) {
    throw new Error(`Rollback restore verification failed for ${temp}: copied files differ from source.`);
  }
  if (expected.size !== tempFiles.length) {
    throw new Error(`Rollback restore verification failed for ${temp}: checksum file list does not match.`);
  }
  for (const relativePath of tempFiles) {
    const entry = expected.get(relativePath);
    if (!entry) throw new Error(`Rollback restore verification failed for ${temp}: unexpected file ${relativePath}.`);
    const file = join(temp, relativePath);
    if (typeof entry.size === "number" && statSync(file).size !== entry.size) {
      throw new Error(`Rollback restore verification failed for ${relativePath}: size mismatch.`);
    }
    if (hashFile(file) !== entry.sha256) {
      throw new Error(`Rollback restore verification failed for ${relativePath}: checksum mismatch.`);
    }
  }
}

function readBackupChecksums(backupDir) {
  return JSON.parse(readFileSync(join(backupDir, "checksums.json"), "utf8")).map((entry) => ({
    ...entry,
    path: toManifestPath(entry.path),
  }));
}

function hashFile(file) {
  const hash = createHash("sha256");
  const fd = openSync(file, "r");
  const buffer = Buffer.alloc(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    closeSync(fd);
  }
  return hash.digest("hex");
}

function toManifestPath(value) {
  return String(value).replace(/\\/g, "/");
}

function manifestPathStartsWith(path, prefix) {
  return toManifestPath(path) === prefix || toManifestPath(path).startsWith(`${prefix}/`);
}

function stripManifestPrefix(path, prefix) {
  const normalized = toManifestPath(path);
  return normalized === prefix ? "" : normalized.slice(prefix.length + 1);
}
