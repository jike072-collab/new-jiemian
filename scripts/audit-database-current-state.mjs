import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = process.cwd();
const includeDbMetadata = process.argv.includes("--db-metadata");
const includeRuntimeSnapshots = process.argv.includes("--runtime-snapshots");

function readJson(path, fallback) {
  try {
    const text = readFileSync(path, "utf8");
    return JSON.parse(text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text);
  } catch {
    return fallback;
  }
}

function fileExists(path) {
  return existsSync(path) && statSync(path).isFile();
}

function dirExists(path) {
  return existsSync(path) && statSync(path).isDirectory();
}

function listFiles(dir, results = []) {
  if (!dirExists(dir)) return results;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, results);
    else if (entry.isFile()) results.push(full);
  }
  return results;
}

function snapshotDirectory(dir) {
  if (!includeRuntimeSnapshots) return { mode: "skipped", reason: "pass --runtime-snapshots for count/size/checksum" };
  if (!dirExists(dir)) return { exists: false, count: 0, size: 0, sha256: null };
  const files = listFiles(dir).sort();
  const hash = createHash("sha256");
  let size = 0;
  for (const file of files) {
    const stats = statSync(file);
    const relativePath = relative(dir, file).replace(/\\/g, "/");
    size += stats.size;
    hash.update(relativePath);
    hash.update("\0");
    hash.update(createHash("sha256").update(readFileSync(file)).digest("hex"));
    hash.update("\0");
    hash.update(String(stats.size));
    hash.update("\0");
  }
  return { exists: true, count: files.length, size, sha256: hash.digest("hex") };
}

function envState(name) {
  const value = process.env[name];
  if (!value) return "missing";
  return "configured/masked";
}

function countJsonArray(path) {
  if (!includeRuntimeSnapshots) return "not_read";
  const value = readJson(path, null);
  if (Array.isArray(value)) return value.length;
  if (value && Array.isArray(value.items)) return value.items.length;
  if (value && Array.isArray(value.providers)) return value.providers.length;
  return value === null ? null : "count_only";
}

function hasPackage(name) {
  const pkg = readJson(join(root, "package.json"), {});
  return Boolean(pkg.dependencies?.[name] || pkg.devDependencies?.[name]);
}

function listDirNames(path) {
  if (!dirExists(path)) return [];
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function listFileNames(path) {
  if (!dirExists(path)) return [];
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
}

function grepFiles(patterns, dirs) {
  const matches = [];
  const regexes = patterns.map((pattern) => new RegExp(pattern, "i"));
  for (const dir of dirs) {
    for (const file of listFiles(join(root, dir))) {
      if (!/\.(ts|tsx|js|mjs|sql|md|json)$/i.test(file)) continue;
      const rel = relative(root, file).replace(/\\/g, "/");
      const text = readFileSync(file, "utf8");
      if (regexes.some((regex) => regex.test(text))) matches.push(rel);
    }
  }
  return Array.from(new Set(matches)).sort();
}

async function optionalDatabaseMetadata() {
  if (!includeDbMetadata) return { mode: "skipped", reason: "pass --db-metadata for schema-only metadata checks" };
  if (!process.env.APP_DATABASE_URL || !process.env.APP_DATABASE_EXPECTED_NAME) {
    return { mode: "skipped", reason: "APP_DATABASE_URL or APP_DATABASE_EXPECTED_NAME missing" };
  }
  const pg = await import("pg");
  const pool = new pg.default.Pool({
    connectionString: process.env.APP_DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 3000,
    statement_timeout: 5000,
    query_timeout: 5000,
    application_name: "stage9a_database_audit_read_only",
  });
  try {
    const db = await pool.query("select current_database() as database_name, version() as version");
    const tables = await pool.query(`
      select table_schema, table_name
      from information_schema.tables
      where table_schema = 'public'
      order by table_schema, table_name
    `);
    const indexes = await pool.query(`
      select schemaname, tablename, indexname
      from pg_indexes
      where schemaname = 'public'
      order by tablename, indexname
    `);
    return {
      mode: "schema_only",
      database: db.rows[0]?.database_name ? "configured/masked" : "missing",
      version: db.rows[0]?.version ? "present_not_read" : "missing",
      tables: tables.rows.length,
      indexes: indexes.rows.length,
      tableNames: tables.rows.map((row) => `${row.table_schema}.${row.table_name}`),
    };
  } finally {
    await pool.end();
  }
}

const dataDir = resolve(root, process.env.DATA_DIR || "data");
const uploadsDir = resolve(root, process.env.UPLOADS_DIR || "uploads");
const dataStagingDir = resolve(root, "data-staging");
const uploadsStagingDir = resolve(root, "uploads-staging");
const migrationsDir = join(root, "db", "migrations");

const report = {
  ok: true,
  stage: "Stage 9A",
  readOnly: true,
  generationEndpointsCalled: false,
  newApiCalled: false,
  liveProviderModelsCalled: false,
  mutatingCommandsExecuted: false,
  database: {
    postgresqlPackage: hasPackage("pg"),
    sqliteFilesTracked: grepFiles(["sqlite"], ["src", "scripts", "db"]).filter((file) => /\.(sqlite|sqlite3|db)$/i.test(file)).length,
    appDatabaseUrl: envState("APP_DATABASE_URL"),
    expectedName: envState("APP_DATABASE_EXPECTED_NAME"),
    orm: {
      prisma: fileExists(join(root, "prisma", "schema.prisma")),
      drizzle: fileExists(join(root, "drizzle.config.ts")) || fileExists(join(root, "drizzle.config.js")),
      typeorm: hasPackage("typeorm"),
      sequelize: hasPackage("sequelize"),
      knex: hasPackage("knex"),
      rawSqlPg: hasPackage("pg"),
    },
    migrations: {
      dirExists: dirExists(migrationsDir),
      files: listFileNames(migrationsDir).filter((name) => name.endsWith(".sql")),
    },
    scripts: {
      migrate: fileExists(join(root, "scripts", "database", "migrate.mjs")),
      backup: fileExists(join(root, "scripts", "ops", "database-backup.mjs")),
      restore: fileExists(join(root, "scripts", "ops", "database-restore.mjs")),
    },
  },
  runtimeStorage: {
    data: snapshotDirectory(dataDir),
    uploads: snapshotDirectory(uploadsDir),
    dataStaging: snapshotDirectory(dataStagingDir),
    uploadsStaging: snapshotDirectory(uploadsStagingDir),
  },
  jsonStores: {
    dataDirExists: includeRuntimeSnapshots ? dirExists(dataDir) : "not_read",
    uploadsDirExists: includeRuntimeSnapshots ? dirExists(uploadsDir) : "not_read",
    dataFiles: includeRuntimeSnapshots ? listFileNames(dataDir) : "not_read",
    libraryCount: countJsonArray(join(dataDir, "library.json")),
    providerCount: countJsonArray(join(dataDir, "providers.json")),
    jobsCount: countJsonArray(join(dataDir, "jobs.json")),
  },
  staticSources: {
    library: grepFiles(["library\\.json", "readLibrary", "addLibraryItem"], ["src/lib/server", "src/app/api"]),
    providers: grepFiles(["providers\\.json", "readProviders", "readPublicProviders"], ["src/lib/server", "src/app/api"]),
    auth: grepFiles(["APP_AUTH_PERSISTENCE_MODE", "auth-store\\.json", "PostgresAuthRepository"], ["src/lib/server", "scripts/database"]),
    billing: grepFiles(["APP_BILLING_PERSISTENCE_MODE", "billing-store\\.json", "billing_orders"], ["src/lib/server", "db/migrations"]),
    quota: grepFiles(["APP_TASK_BILLING_PERSISTENCE_MODE", "quota-usage-log\\.json", "task_billing_records"], ["src/lib/server", "db/migrations"]),
    storageIsolation: grepFiles(["DATA_DIR", "UPLOADS_DIR", "PORT=3107"], ["src/lib/server", "scripts", "docs"]),
  },
  directories: {
    db: listDirNames(join(root, "db")),
    scriptsDatabase: listFileNames(join(root, "scripts", "database")),
    scriptsOps: listFileNames(join(root, "scripts", "ops")).filter((name) => /backup|restore|deploy|rollback|service|health|watchdog/i.test(name)),
  },
  databaseMetadata: await optionalDatabaseMetadata(),
};

console.log(JSON.stringify(report, null, 2));
