import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { createDatabaseBackup } from "./database-backup.mjs";
import { safeGit } from "./git-utils.mjs";

export function snapshotDirectory(path) {
  if (!existsSync(path)) return { path, exists: false, count: 0, size: 0, latestUtc: null };
  const files = listFiles(path);
  let size = 0;
  let latest = 0;
  for (const file of files) {
    const stats = statSync(file);
    size += stats.size;
    latest = Math.max(latest, stats.mtimeMs);
  }
  return {
    path,
    exists: true,
    count: files.length,
    size,
    latestUtc: latest ? new Date(latest).toISOString() : null,
  };
}

export function createServiceBackup(config, options = {}) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
  const backupDir = join(config.backupRoot, `${config.backupPrefix}-${stamp}`);
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
  });

  const meta = {
    backupVersion: 2,
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

export function writeRollbackScript(config, backup, targetCommit) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$root = '${config.root.replace(/'/g, "''")}'`,
    `$backup = '${backup.backupDir.replace(/'/g, "''")}'`,
    `$commit = '${targetCommit}'`,
    "Set-Location -LiteralPath $root",
    `node scripts/ops/rollback-service.mjs ${config.service} --root $root --backup $backup --commit $commit --mode full`,
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
  for (const entry of JSON.parse(readFileSync(checksumsPath, "utf8"))) {
    const file = join(backupDir, entry.path);
    if (!existsSync(file)) throw new Error(`Rollback checksum target is missing: ${entry.path}`);
    const actual = createHash("sha256").update(readFileSync(file)).digest("hex");
    if (actual !== entry.sha256) throw new Error(`Rollback checksum mismatch: ${entry.path}`);
  }
  return manifest;
}

export function restoreDataAndUploads(config, backupDir) {
  verifyBackupManifest(config, backupDir);
  restoreDirectory(join(backupDir, "data"), config.dataDir);
  restoreDirectory(join(backupDir, "uploads"), config.uploadsDir);
}

export function checksumFiles(root) {
  return listFiles(root).filter((file) => !["checksums.json"].includes(relative(root, file))).map((file) => ({
    path: relative(root, file),
    sha256: createHash("sha256").update(readFileSync(file)).digest("hex"),
  }));
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

function restoreDirectory(source, target) {
  if (!existsSync(source)) throw new Error(`Rollback source directory is missing: ${source}`);
  mkdirSync(dirname(target), { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
  const temp = `${target}.restore-${stamp}`;
  const old = `${target}.old-${stamp}`;
  cpSync(source, temp, { recursive: true, force: true });
  const sourceSnapshot = snapshotDirectory(source);
  const tempSnapshot = snapshotDirectory(temp);
  if (sourceSnapshot.count !== tempSnapshot.count || sourceSnapshot.size !== tempSnapshot.size) {
    rmSync(temp, { recursive: true, force: true });
    throw new Error(`Rollback restore verification failed for ${target}.`);
  }
  if (existsSync(target)) renameSync(target, old);
  try {
    renameSync(temp, target);
    if (existsSync(old)) rmSync(old, { recursive: true, force: true });
  } catch (error) {
    if (existsSync(target)) rmSync(target, { recursive: true, force: true });
    if (existsSync(old)) renameSync(old, target);
    if (existsSync(temp)) rmSync(temp, { recursive: true, force: true });
    throw error;
  }
}
