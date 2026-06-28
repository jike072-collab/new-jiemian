import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

const requiredDocs = [
  "docs/DATABASE_CURRENT_STATE_AUDIT.md",
  "docs/DATABASE_DOMAIN_MODEL.md",
  "docs/DATABASE_MIGRATION_PLAN.md",
  "docs/DATABASE_SECURITY_AND_BACKUP_PLAN.md",
  "docs/DATABASE_STAGE9_IMPLEMENTATION_PLAN.md",
  "docs/DATABASE_MVP_FOUNDATION.md",
  "docs/DATABASE_MIGRATION_RUNBOOK.md",
  "docs/DATABASE_BACKUP_RESTORE_RUNBOOK.md",
  "docs/DATABASE_MULTI_USER_CLOUD_READINESS.md",
  "docs/DATABASE_STAGE9CB_INTEGRATION.md",
  "docs/LIBRARY_DATABASE_BACKEND.md",
  "docs/GENERATION_JOBS_DATABASE_BACKEND.md",
  "docs/DATABASE_IMPORT_DRY_RUN_PLAN.md",
];

const requiredTerms = new Map([
  ["docs/DATABASE_CURRENT_STATE_AUDIT.md", [
    "PostgreSQL",
    "JSON",
    "data/library.json",
    "data/providers.json",
    "data/uploads",
    "no migration",
  ]],
  ["docs/DATABASE_DOMAIN_MODEL.md", [
    "users",
    "providers",
    "provider_models",
    "generation_jobs",
    "assets",
    "library_items",
    "quota_ledger",
    "orders",
    "payments",
    "api_call_logs",
    "audit_logs",
    "file_storage_objects",
  ]],
  ["docs/DATABASE_MIGRATION_PLAN.md", [
    "raw SQL",
    "schema drift",
    "3107",
    "3106",
    "backup",
    "rollback",
  ]],
  ["docs/DATABASE_SECURITY_AND_BACKUP_PLAN.md", [
    "APP_DATABASE_URL",
    "pg_dump",
    "pg_restore --list",
    "checksum",
    "rollback authorization",
    "Do not commit",
  ]],
  ["docs/DATABASE_STAGE9_IMPLEMENTATION_PLAN.md", [
    "Stage 9B",
    "Stage 9C",
    "live provider",
    "real generation",
    "3106",
    "schema",
  ]],
  ["docs/DATABASE_MVP_FOUNDATION.md", [
    "generation_jobs",
    "assets",
    "library_items",
    "provider_model_snapshots",
    "api_call_logs",
    "error_events",
    "audit_logs",
    "quota_accounts",
    "quota_ledger",
    "Existing JSON and filesystem behavior remains active",
  ]],
  ["docs/DATABASE_MIGRATION_RUNBOOK.md", [
    "db:schema:check",
    "db:migrate:check",
    "STAGE9C_TEST_DATABASE_URL",
    "Forbidden Production Commands",
  ]],
  ["docs/DATABASE_BACKUP_RESTORE_RUNBOOK.md", [
    "pg_dump",
    "pg_restore --list",
    "data",
    "uploads",
    "Do not commit",
  ]],
  ["docs/DATABASE_MULTI_USER_CLOUD_READINESS.md", [
    "user_id",
    "owner",
    "object_storage",
    "Stage 9C-B",
    "Stage 9D",
    "Stage 9E",
  ]],
  ["docs/DATABASE_STAGE9CB_INTEGRATION.md", [
    "Stage 9C-B",
    "default-off",
    "LIBRARY_STORAGE_BACKEND",
    "GENERATION_JOBS_BACKEND",
    "3107",
    "JSON",
    "NewAPI",
  ]],
  ["docs/LIBRARY_DATABASE_BACKEND.md", [
    "data/library.json",
    "uploads",
    "soft delete",
    "JSON mode",
    "API contract",
  ]],
  ["docs/GENERATION_JOBS_DATABASE_BACKEND.md", [
    "generation_jobs",
    "queued",
    "running",
    "succeeded",
    "failed",
    "NewAPI",
  ]],
  ["docs/DATABASE_IMPORT_DRY_RUN_PLAN.md", [
    "db:library-import:plan",
    "db:library-consistency:check",
    "--apply",
    "read-only",
    "rollback",
  ]],
]);

const forbiddenSecretPatterns = [
  /postgres(?:ql)?:\/\/[^`\s)]+:[^`\s)]+@/i,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/,
  /AKIA[A-Z0-9]{16}/,
  /Authorization:\s*Bearer\s+[A-Za-z0-9._-]+/i,
  /Cookie:\s*[^`\n]+/i,
];

const failures = [];
const checked = [];

for (const doc of requiredDocs) {
  const full = join(root, doc);
  if (!existsSync(full)) {
    failures.push(`${doc} is missing`);
    continue;
  }
  const text = readFileSync(full, "utf8");
  checked.push(doc);
  for (const term of requiredTerms.get(doc) || []) {
    if (!text.includes(term)) failures.push(`${doc} missing required term: ${term}`);
  }
  for (const pattern of forbiddenSecretPatterns) {
    if (pattern.test(text)) failures.push(`${doc} contains a forbidden secret-shaped value`);
  }
}

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
for (const script of ["audit:database", "check:database-docs"]) {
  if (!pkg.scripts?.[script]) failures.push(`package.json missing script: ${script}`);
}

const auditScript = readFileSync(join(root, "scripts", "audit-database-current-state.mjs"), "utf8");
for (const forbidden of [
  /\binsert\s+into\b/i,
  /\bupdate\s+[a-z_"][a-z0-9_".]*\s+set\b/i,
  /\bdelete\s+from\b/i,
  /\balter\s+(table|database|schema)\b/i,
  /\bcreate\s+table\b/i,
  /\bdrop\s+(table|database|schema|index)\b/i,
  /\btruncate\s+table\b/i,
  /pg_dump/i,
  /pg_restore/i,
]) {
  if (forbidden.test(auditScript)) failures.push(`audit script contains forbidden mutating token: ${forbidden}`);
}

const result = {
  ok: failures.length === 0,
  checkedDocs: checked.length,
  requiredDocs: requiredDocs.length,
  generationEndpointsCalled: false,
  newApiCalled: false,
  liveProviderModelsCalled: false,
  mutatingCommandsExecuted: false,
  failures,
};

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);
