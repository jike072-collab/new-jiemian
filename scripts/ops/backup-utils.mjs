import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { runSync } from "./process-utils.mjs";

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

  const meta = {
    createdAt: new Date().toISOString(),
    service: config.service,
    backupDir,
    root: config.root,
    commit: safeGit(config.root, ["rev-parse", "HEAD"]),
    branch: safeGit(config.root, ["branch", "--show-current"]),
    data: snapshotDirectory(config.dataDir),
    uploads: snapshotDirectory(config.uploadsDir),
    dbFileCount: dbFiles.length,
    note: options.note || "service backup",
  };
  writeFileSync(join(backupDir, "backup-meta.json"), JSON.stringify(meta, null, 2));
  const checksums = checksumFiles(backupDir);
  writeFileSync(join(backupDir, "checksums.json"), JSON.stringify(checksums, null, 2));
  return { backupDir, meta, checksums };
}

export function writeRollbackScript(config, backup, targetCommit) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$root = '${config.root.replace(/'/g, "''")}'`,
    `$backup = '${backup.backupDir.replace(/'/g, "''")}'`,
    `$commit = '${targetCommit}'`,
    "Set-Location $root",
    "git checkout --detach $commit",
    "npm ci",
    "npm run build",
    "if (Test-Path -LiteralPath (Join-Path $backup 'data')) { Copy-Item -LiteralPath (Join-Path $backup 'data') -Destination $root -Recurse -Force }",
    "if (Test-Path -LiteralPath (Join-Path $backup 'uploads')) { Copy-Item -LiteralPath (Join-Path $backup 'uploads') -Destination $root -Recurse -Force }",
    `node scripts/ops/stop-service.mjs ${config.service} --root $root`,
    `node scripts/ops/start-service.mjs ${config.service} --root $root`,
  ].join("\r\n");
  const rollbackPath = join(backup.backupDir, `rollback-${config.service}.ps1`);
  writeFileSync(rollbackPath, script);
  return rollbackPath;
}

export function checksumFiles(root) {
  return listFiles(root).map((file) => ({
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

function safeGit(root, args) {
  try {
    return runSync("git", args, { cwd: root }).stdout.trim();
  } catch {
    return "";
  }
}
