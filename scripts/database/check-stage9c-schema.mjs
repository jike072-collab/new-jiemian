#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const migrationPath = join(root, "db", "migrations", "007_database_mvp_foundation.sql");
const repositoryPath = join(root, "src", "lib", "server", "database", "mvp-repositories.ts");

const requiredTables = new Map([
  ["generation_jobs", [
    "id",
    "user_id",
    "kind",
    "status",
    "prompt",
    "input_asset_id",
    "output_asset_id",
    "provider",
    "provider_model",
    "request_hash",
    "error_code",
    "user_visible_error",
    "internal_error_masked",
    "created_at",
    "updated_at",
    "started_at",
    "completed_at",
  ]],
  ["assets", [
    "id",
    "kind",
    "storage_type",
    "path_or_url",
    "mime_type",
    "size_bytes",
    "sha256",
    "width",
    "height",
    "duration_ms",
    "created_at",
    "deleted_at",
  ]],
  ["library_items", [
    "id",
    "asset_id",
    "generation_job_id",
    "user_id",
    "title",
    "kind",
    "source",
    "is_deleted",
    "created_at",
    "updated_at",
    "deleted_at",
  ]],
  ["provider_model_snapshots", [
    "id",
    "provider",
    "model_id",
    "display_name",
    "capability",
    "raw_response_masked",
    "checked_at",
    "created_at",
  ]],
  ["api_call_logs", [
    "id",
    "provider",
    "endpoint_kind",
    "generation_job_id",
    "status",
    "latency_ms",
    "request_id",
    "error_code",
    "error_masked",
    "created_at",
  ]],
  ["error_events", [
    "id",
    "scope",
    "severity",
    "code",
    "message_masked",
    "context_masked",
    "created_at",
  ]],
  ["audit_logs", [
    "id",
    "actor_id",
    "action",
    "target_type",
    "target_id",
    "ip_hash",
    "user_agent_hash",
    "metadata_masked",
    "created_at",
  ]],
  ["quota_accounts", [
    "id",
    "user_id",
    "balance",
    "unit",
    "created_at",
    "updated_at",
  ]],
  ["quota_ledger", [
    "id",
    "quota_account_id",
    "direction",
    "amount",
    "reason",
    "generation_job_id",
    "idempotency_key",
    "created_at",
  ]],
]);

const requiredIndexTerms = [
  "generation_jobs_user_created_idx",
  "generation_jobs_status_created_idx",
  "generation_jobs_kind_created_idx",
  "generation_jobs_created_idx",
  "generation_jobs_provider_model_idx",
  "assets_kind_created_idx",
  "assets_storage_type_created_idx",
  "assets_sha256_idx",
  "assets_created_idx",
  "assets_deleted_at_idx",
  "library_items_user_created_idx",
  "library_items_asset_id_idx",
  "library_items_generation_job_id_idx",
  "library_items_kind_created_idx",
  "library_items_deleted_created_idx",
  "api_call_logs_provider_endpoint_created_idx",
  "api_call_logs_generation_job_id_idx",
  "api_call_logs_status_created_idx",
  "api_call_logs_created_idx",
  "error_events_scope_severity_created_idx",
  "error_events_code_created_idx",
  "error_events_created_idx",
  "quota_ledger_account_created_idx",
  "quota_ledger_generation_job_id_idx",
  "quota_ledger_account_idempotency_unique_idx",
];

const repositoryTerms = [
  "createAsset",
  "createGenerationJob",
  "updateGenerationJob",
  "listGenerationJobs",
  "createLibraryItem",
  "listLibraryItems",
  "appendProviderModelSnapshot",
  "listProviderModelSnapshots",
  "appendApiCallLog",
  "listApiCallLogsForJob",
  "appendErrorEvent",
  "listErrorEvents",
  "redactSecret",
  "redactJson",
];

const forbiddenSecretPatterns = [
  /postgres(?:ql)?:\/\/[^`\s)]+:[^`\s)]+@/i,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/,
  /AKIA[A-Z0-9]{16}/,
  /Authorization:\s*Bearer\s+[A-Za-z0-9._-]+/i,
  new RegExp("Cookie" + ":\\s*[^`\\n]+", "i"),
];

const failures = [];

function fail(message) {
  failures.push(message);
}

function readText(path) {
  if (!existsSync(path)) {
    fail(`${path} is missing`);
    return "";
  }
  const text = readFileSync(path, "utf8");
  if (text.charCodeAt(0) === 0xFEFF) fail(`${path} has an unexpected BOM`);
  return text.replace(/^\uFEFF/, "");
}

function tableBlock(sql, table) {
  const pattern = new RegExp(`create\\s+table\\s+if\\s+not\\s+exists\\s+${table}\\s*\\(([\\s\\S]*?)\\n\\);`, "i");
  return sql.match(pattern)?.[1] || "";
}

const sql = readText(migrationPath);
const repository = readText(repositoryPath);
const combined = `${sql}\n${repository}`;

for (const pattern of forbiddenSecretPatterns) {
  if (pattern.test(combined)) fail("Stage 9C-A database files contain a forbidden secret-shaped value");
}

for (const [table, columns] of requiredTables) {
  const block = tableBlock(sql, table);
  if (!block) {
    fail(`migration missing table: ${table}`);
    continue;
  }
  for (const column of columns) {
    if (!new RegExp(`(^|\\n)\\s*${column}\\s+`, "i").test(block)) {
      fail(`${table} missing column: ${column}`);
    }
  }
}

for (const term of requiredIndexTerms) {
  if (!sql.includes(term)) fail(`migration missing index: ${term}`);
}

for (const term of [
  "generation_jobs_status_check",
  "queued",
  "running",
  "succeeded",
  "failed",
  "canceled",
  "references assets(id)",
  "references generation_jobs(id)",
  "references app_users(local_user_id)",
]) {
  if (!sql.includes(term)) fail(`migration missing required relationship or status term: ${term}`);
}

for (const term of repositoryTerms) {
  if (!repository.includes(term)) fail(`repository missing required term: ${term}`);
}

if (/create\s+table\s+if\s+not\s+exists\s+(orders|payments)\b/i.test(sql)) {
  fail("Stage 9C-A migration must not create real orders or payments tables");
}

const report = {
  ok: failures.length === 0,
  checkedMigration: "db/migrations/007_database_mvp_foundation.sql",
  checkedRepository: "src/lib/server/database/mvp-repositories.ts",
  requiredTables: requiredTables.size,
  requiredIndexes: requiredIndexTerms.length,
  productionDbWritten: false,
  stagingDbWritten: false,
  migrationExecuted: false,
  generationEndpointsCalled: false,
  newApiCalled: false,
  failures,
};

console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(1);
