#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, normalize, relative, resolve, sep } from "node:path";

const root = process.cwd();
const failures = [];

if (process.argv.includes("--apply")) {
  console.error(JSON.stringify({
    ok: false,
    failures: ["--apply is intentionally unsupported by the Stage 9C-B consistency check."],
    databaseWritten: false,
    dataUploadsModified: false,
  }, null, 2));
  process.exit(1);
}

function runtimeRoot(name, fallback) {
  const raw = process.env[name]?.trim() || fallback;
  return resolve(root, raw);
}

function safeRel(path) {
  const rel = relative(root, path).replace(/\\/g, "/");
  if (!rel || rel.startsWith("..") || normalize(rel).startsWith(`..${sep}`)) return basename(path);
  return rel;
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  const text = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(text);
}

function listFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) out.push(full);
    }
  }
  return out.sort();
}

function isSafeStoredName(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  if (value.includes("/") || value.includes("\\") || value.includes("..")) return false;
  if (/^[a-z]:/i.test(value) || value.startsWith("/") || value.startsWith("\\")) return false;
  return /^[a-z0-9._-]+$/i.test(value);
}

function pushFailure(code, detail) {
  failures.push({ code, detail });
}

const dataDir = runtimeRoot("DATA_DIR", "data");
const uploadsDir = runtimeRoot("UPLOADS_DIR", "uploads");
const libraryPath = join(dataDir, "library.json");
const jobsPath = join(dataDir, "jobs.json");
const libraryJson = readJson(libraryPath, []);
const jobsJson = readJson(jobsPath, []);
const library = Array.isArray(libraryJson) ? libraryJson : [];
const jobs = Array.isArray(jobsJson) ? jobsJson : [];
const uploadFiles = listFiles(uploadsDir);
const uploadNames = new Set(uploadFiles.map((file) => safeRel(file).split("/").pop()).filter(Boolean));
const libraryIds = new Set();
const assetRefs = new Set();

for (const item of library) {
  if (!item?.id || libraryIds.has(item.id)) pushFailure("duplicate_library_item", "masked");
  if (item?.id) libraryIds.add(item.id);
  const storedName = item?.output?.storedName;
  if (storedName !== undefined) {
    if (!isSafeStoredName(storedName)) {
      pushFailure("unsafe_file_reference", "masked");
      continue;
    }
    assetRefs.add(storedName);
    if (!uploadNames.has(storedName)) pushFailure("missing_asset_file", "masked");
  }
}

const jobIds = new Set();
for (const job of jobs) {
  if (!job?.id || jobIds.has(job.id)) pushFailure("duplicate_generation_job", "masked");
  if (job?.id) jobIds.add(job.id);
  if (job?.libraryItemId && !libraryIds.has(job.libraryItemId)) pushFailure("orphan_job", "masked");
  if (job?.status === "done") {
    const item = library.find((candidate) => candidate?.id === job.libraryItemId);
    if (item && !item.output) pushFailure("succeeded_job_missing_output_asset", "masked");
  }
  if (job?.status === "failed") {
    const item = library.find((candidate) => candidate?.id === job.libraryItemId);
    if (item?.status === "done") pushFailure("failed_job_has_success_library_item", "masked");
  }
}

for (const file of uploadFiles) {
  const name = safeRel(file).split("/").pop() || "";
  if (name && !assetRefs.has(name)) pushFailure("orphan_asset_file", "masked");
}

const sourceFiles = [
  "src/lib/server/database/library-jobs-adapter.ts",
  "src/lib/server/database/stage9cb-flags.ts",
  "src/lib/server/library.ts",
].map((file) => join(root, file));

for (const file of sourceFiles) {
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (/path_or_url:\s*(?:dataDir|uploadsDir|process\.cwd|[a-zA-Z]+Root)/.test(text)) {
    pushFailure("absolute_path_mapping_risk", safeRel(file));
  }
}

const report = {
  ok: failures.length === 0,
  mode: "read-only",
  databaseConnected: false,
  databaseWritten: false,
  dataUploadsModified: false,
  productionDbWritten: false,
  stagingDbWritten: false,
  migrationExecuted: false,
  generationEndpointsCalled: false,
  newApiCalled: false,
  realProviderCalled: false,
  checked: {
    libraryItemsAssets: library.length,
    generationJobs: jobs.length,
    uploadFiles: uploadFiles.length,
    sourceFiles: sourceFiles.map(safeRel),
  },
  findings: {
    libraryItemsAssets: failures.filter((failure) => /library|asset|file/.test(failure.code)).length,
    assetsFiles: failures.filter((failure) => /asset|file/.test(failure.code)).length,
    orphanJobs: failures.filter((failure) => failure.code === "orphan_job").length,
    orphanAssets: failures.filter((failure) => failure.code === "orphan_asset_file").length,
    pathSafety: failures.filter((failure) => /path|unsafe/.test(failure.code)).length,
  },
  failures,
  secrets: "masked",
};

console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(1);
