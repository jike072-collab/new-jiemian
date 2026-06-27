import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative } from "node:path";

const root = process.cwd();

const requiredDocs = [
  "docs/DATABASE_CURRENT_STATE_AUDIT.md",
  "docs/DATABASE_DOMAIN_MODEL.md",
  "docs/DATABASE_MIGRATION_PLAN.md",
  "docs/DATABASE_SECURITY_AND_BACKUP_PLAN.md",
  "docs/DATABASE_STAGE9_IMPLEMENTATION_PLAN.md",
  "docs/DATABASE_STAGE9B_GATE.md",
  "docs/DATABASE_MVP_SCOPE.md",
  "docs/DATABASE_STAGE9C_PRECONDITIONS.md",
];

const requiredDocTerms = new Map([
  ["docs/DATABASE_STAGE9B_GATE.md", [
    "Stage 9B",
    "read-only",
    "does not create tables",
    "run migrations",
    "3106",
    "3107",
    "check:database-gate",
    "production DB",
    "staging DB",
  ]],
  ["docs/DATABASE_MVP_SCOPE.md", [
    "generation_jobs",
    "assets",
    "library_items",
    "api_call_logs",
    "error_events",
    "users",
    "sessions",
    "quota_ledger",
    "orders",
    "payments",
    "provider secret storage",
  ]],
  ["docs/DATABASE_STAGE9C_PRECONDITIONS.md", [
    "separate user authorization",
    "throwaway test database",
    "pg_dump",
    "pg_restore --list",
    "data",
    "uploads",
    "3106",
    "3107",
    "production migration",
  ]],
  ["docs/DATABASE_SECURITY_AND_BACKUP_PLAN.md", [
    "pg_dump",
    "pg_restore --list",
    "Do not commit",
    "Database/File Consistency",
    "Stop-Release Conditions",
  ]],
]);

const sensitiveValuePatterns = [
  /postgres(?:ql)?:\/\/[^`\s)]+:[^`\s)]+@/i,
  /\b(?:APP_DATABASE_URL|DATABASE_URL|ADMIN_PASSWORD|API_KEY|NEWAPI_API_KEY)\s*=\s*["']?[^"'\s]+/i,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/,
  /AKIA[A-Z0-9]{16}/,
  /Authorization:\s*Bearer\s+[A-Za-z0-9._-]+/i,
  /Cookie:\s*[^`\n]+/i,
];

const lifecycleScripts = [
  "preinstall",
  "install",
  "postinstall",
  "prepare",
  "prebuild",
  "build",
  "postbuild",
  "precheck",
  "check",
  "postcheck",
];

const dangerousLifecyclePatterns = [
  /\bprisma\s+migrate\b/i,
  /\bprisma\s+db\s+push\b/i,
  /\bdrizzle(?:-kit)?\s+push\b/i,
  /\bknex\s+migrate\b/i,
  /\bsequelize\s+db:migrate\b/i,
  /\btypeorm\s+migration:run\b/i,
  /\bmigrate(?::|$|\s)/i,
  /\bseed(?::|$|\s)/i,
  /\bdb:(?:push|seed|reset|migrate)\b/i,
  /\bscripts\/database\/migrate\.mjs\s+up\b/i,
  /\bscripts\\database\\migrate\.mjs\s+up\b/i,
];

const mutatingSqlPatterns = [
  /\binsert\s+into\b/i,
  /\bupdate\s+["a-z_][\w".]*\s+set\b/i,
  /\bdelete\s+from\b/i,
  /\balter\s+(table|database|schema|index)\b/i,
  /\bcreate\s+(table|database|schema|index)\b/i,
  /\bdrop\s+(table|database|schema|index)\b/i,
  /\btruncate\s+(table\s+)?\b/i,
];

const forbiddenTrackedPatterns = [
  /^\.env(?:\.local)?$/i,
  /^data\//i,
  /^uploads\//i,
  /^data-staging\//i,
  /^uploads-staging\//i,
  /^\.runtime\//i,
  /(?:^|\/).+\.pid$/i,
  /(?:^|\/).+\.log$/i,
  /(?:^|\/).+\.(?:dump|bak|backup|sqlite|sqlite3|db)$/i,
  /(?:^|\/)(?:backups?|backup-artifacts|restore-artifacts)\//i,
  /^(?:screenshots?|videos?|test-results|playwright-report)\//i,
  /(?:^|\/)(?:node_modules|\.next|dist)\//i,
];

const failures = [];
const warnings = [];

function readText(path) {
  return readFileSync(path, "utf8").replace(/^\uFEFF/, "");
}

function textForSecretScan(text) {
  return text.replaceAll("postgresql://postgres:postgres@127.0.0.1:5432/rollback_drill", "postgresql://local-test/masked");
}

function readJson(path, fallback) {
  try {
    return JSON.parse(readText(path));
  } catch {
    return fallback;
  }
}

function fileExists(path) {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

function dirExists(path) {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function listFileNames(dir, suffix = "") {
  if (!dirExists(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => !suffix || name.endsWith(suffix))
    .sort();
}

function hasPackage(pkg, name) {
  return Boolean(pkg.dependencies?.[name] || pkg.devDependencies?.[name]);
}

function envState(name) {
  return process.env[name] ? "configured/masked" : "missing";
}

function gitTrackedFiles() {
  try {
    const output = execFileSync("git", ["ls-files"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return {
      mode: "present_not_read",
      files: output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
    };
  } catch {
    return { mode: "not_found", files: [] };
  }
}

function scanTrackedFromEnv() {
  const list = process.env.STAGE9B_TRACKED_FILES;
  if (!list) return [];
  return list.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function fail(message) {
  failures.push(message);
}

const pkg = readJson(join(root, "package.json"), {});
const scripts = pkg.scripts || {};

for (const doc of requiredDocs) {
  const full = join(root, doc);
  if (!fileExists(full)) {
    fail(`${doc} is missing`);
    continue;
  }
  const text = textForSecretScan(readText(full));
  for (const term of requiredDocTerms.get(doc) || []) {
    if (!text.includes(term)) fail(`${doc} missing required term: ${term}`);
  }
  for (const pattern of sensitiveValuePatterns) {
    if (pattern.test(text)) fail(`${doc} contains a forbidden secret-shaped value`);
  }
}

if (scripts["check:database-gate"] !== "node scripts/check-database-implementation-gate.mjs") {
  fail("package.json missing exact check:database-gate script");
}

if (!scripts.check?.includes("npm run check:database-gate")) {
  fail("package.json check script does not run check:database-gate");
}

for (const name of lifecycleScripts) {
  const command = scripts[name];
  if (!command) continue;
  for (const pattern of dangerousLifecyclePatterns) {
    if (pattern.test(command)) {
      fail(`package script ${name} has dangerous DB write/migration wiring`);
    }
  }
}

for (const [name, command] of Object.entries(scripts)) {
  if (/(?:^|:)apply$/.test(name) || /--confirm-apply/i.test(command)) {
    warnings.push(`manual apply script present and must stay out of CI lifecycle: ${name}`);
  }
}

const ciPath = join(root, ".github", "workflows", "ci.yml");
if (!fileExists(ciPath)) {
  fail(".github/workflows/ci.yml is missing");
} else {
  const ciText = readText(ciPath);
  const gateRuns = ciText.match(/npm run check:database-gate/g)?.length || 0;
  if (gateRuns < 2) fail("CI must run check:database-gate in Linux and Windows jobs");
}

const gatePath = join(root, "scripts", "check-database-implementation-gate.mjs");
const gateText = readText(gatePath);
for (const pattern of mutatingSqlPatterns) {
  const matches = gateText.match(pattern) || [];
  if (matches.length > 1) {
    fail(`gate script contains executable-looking DB mutation token: ${pattern}`);
  }
}
if (/new\s+Pool|Client\s*\(|\.query\s*\(/.test(gateText)) {
  fail("gate script must not connect to or query a database");
}

const migrationsDir = join(root, "db", "migrations");
const migrationFiles = listFileNames(migrationsDir, ".sql");
const databaseScriptsDir = join(root, "scripts", "database");
const databaseScriptFiles = listFileNames(databaseScriptsDir, ".mjs");

if (!hasPackage(pkg, "pg")) fail("package.json missing pg dependency");
if (!dirExists(migrationsDir)) fail("db/migrations directory is missing");
if (!fileExists(join(root, "scripts", "database", "migrate.mjs"))) {
  fail("scripts/database/migrate.mjs is missing");
}
if (!fileExists(join(root, "src", "lib", "server", "database", "config.ts"))) {
  fail("database config module is missing");
}

const trackedFromEnv = scanTrackedFromEnv();
for (const file of trackedFromEnv) {
  for (const pattern of forbiddenTrackedPatterns) {
    if (pattern.test(file.replace(/\\/g, "/"))) fail(`forbidden runtime or secret file is tracked: ${file}`);
  }
}

const gitTracked = gitTrackedFiles();
for (const file of gitTracked.files) {
  for (const pattern of forbiddenTrackedPatterns) {
    if (pattern.test(file.replace(/\\/g, "/"))) fail(`forbidden runtime or secret file is tracked: ${file}`);
  }
}

for (const path of [
  join(root, ".env"),
  join(root, ".env.local"),
]) {
  if (fileExists(path)) warnings.push(`${relative(root, path).replace(/\\/g, "/")} exists locally; do not commit it`);
}

const sourceFilesToScan = [
  ...requiredDocs.map((doc) => join(root, doc)),
  join(root, "package.json"),
  ciPath,
].filter((file) => /\.(?:ts|tsx|js|mjs|md|yml|yaml|json|sql)$/i.test(file));

let secretScanFiles = 0;
for (const file of sourceFilesToScan) {
  if (!fileExists(file)) continue;
  secretScanFiles += 1;
  const rel = relative(root, file).replace(/\\/g, "/");
  const text = textForSecretScan(readText(file));
  for (const pattern of sensitiveValuePatterns) {
    if (pattern.test(text)) fail(`${rel} contains a forbidden secret-shaped value`);
  }
}

const report = {
  ok: failures.length === 0,
  stage: "Stage 9B",
  readOnly: true,
  databaseConnected: false,
  migrationExecuted: false,
  schemaChanged: false,
  productionDbWritten: false,
  stagingDbWritten: false,
  temporaryDbWritten: false,
  generationEndpointsCalled: false,
  newApiCalled: false,
  liveProviderModelsCalled: false,
  costIncurred: false,
  environment: {
    APP_DATABASE_URL: envState("APP_DATABASE_URL"),
    DATABASE_URL: envState("DATABASE_URL"),
    APP_DATABASE_EXPECTED_NAME: envState("APP_DATABASE_EXPECTED_NAME"),
  },
  toolchain: {
    pgDependency: hasPackage(pkg, "pg"),
    prismaSchema: fileExists(join(root, "prisma", "schema.prisma")),
    drizzleConfig: fileExists(join(root, "drizzle.config.ts")) || fileExists(join(root, "drizzle.config.js")),
    knexConfig: fileExists(join(root, "knexfile.ts")) || fileExists(join(root, "knexfile.js")),
    rawSqlMigrateScript: fileExists(join(root, "scripts", "database", "migrate.mjs")),
    migrationsDir: dirExists(migrationsDir),
    migrationFiles: migrationFiles.length,
    schemaFiles: [
      "src/lib/server/database/config.ts",
      "src/lib/server/database/client.ts",
      ...migrationFiles.map((name) => `db/migrations/${name}`),
    ],
  },
  scripts: {
    checkDatabaseGate: Boolean(scripts["check:database-gate"]),
    checkRunsDatabaseGate: Boolean(scripts.check?.includes("npm run check:database-gate")),
    migrate: Boolean(scripts.migrate),
    migrateStatus: Boolean(scripts["migrate:status"]),
    seedCommands: Object.keys(scripts).filter((name) => /seed/i.test(name)).sort(),
    manualApplyCommands: Object.keys(scripts).filter((name) => /apply/i.test(name)).sort(),
    databaseScriptFiles,
  },
  ci: {
    workflow: fileExists(ciPath),
    checkDatabaseGateRuns: fileExists(ciPath)
      ? (readText(ciPath).match(/npm run check:database-gate/g)?.length || 0)
      : 0,
  },
  gitSafety: {
    trackedFileSource: gitTracked.mode,
    trackedFilesChecked: gitTracked.files.length,
    forbiddenTrackedFilesProvided: trackedFromEnv.length,
  },
  backupRestoreGate: {
    pgDumpDocumented: readText(join(root, "docs", "DATABASE_SECURITY_AND_BACKUP_PLAN.md")).includes("pg_dump"),
    pgRestoreListDocumented: readText(join(root, "docs", "DATABASE_SECURITY_AND_BACKUP_PLAN.md")).includes("pg_restore --list"),
    backupOutsideGitDocumented: readText(join(root, "docs", "DATABASE_SECURITY_AND_BACKUP_PLAN.md")).includes("Do not commit"),
    databaseFileConsistencyDocumented: readText(join(root, "docs", "DATABASE_SECURITY_AND_BACKUP_PLAN.md")).includes("Database/File Consistency"),
  },
  mvpScope: {
    allowedFirstBatch: ["generation_jobs", "assets", "library_items", "api_call_logs", "error_events"],
    deferredFirstBatch: [
      "users",
      "sessions",
      "auth_accounts",
      "quota_accounts",
      "quota_ledger",
      "orders",
      "payments",
      "provider secret storage",
      "system_settings",
      "audit_logs",
      "deleted_items",
    ],
  },
  scannedFiles: secretScanFiles,
  warnings,
  failures,
};

console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(1);
