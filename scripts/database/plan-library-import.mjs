#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, normalize, relative, resolve, sep } from "node:path";

const root = process.cwd();

if (process.argv.includes("--apply")) {
  console.error(JSON.stringify({
    ok: false,
    error: "--apply is intentionally unsupported in Stage 9C-B.",
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

function outputStoredName(item) {
  const storedName = item?.output?.storedName;
  return typeof storedName === "string" && storedName.trim() ? storedName.trim() : "";
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
const referencedNames = library.map(outputStoredName).filter(Boolean);
const duplicateRecords = referencedNames.length - new Set(referencedNames).size;
const missingFiles = referencedNames.filter((name) => !uploadNames.has(name));
const orphanFiles = uploadFiles.filter((file) => !referencedNames.includes(safeRel(file).split("/").pop() || ""));
const mappableRecords = library.filter((item) => {
  const storedName = outputStoredName(item);
  return !storedName || uploadNames.has(storedName);
});
const riskLevel = missingFiles.length || orphanFiles.length || duplicateRecords ? "medium" : "low";

const report = {
  ok: true,
  mode: "dry-run",
  applyExecuted: false,
  databaseWritten: false,
  dataUploadsModified: false,
  productionDbWritten: false,
  stagingDbWritten: false,
  generationEndpointsCalled: false,
  newApiCalled: false,
  realProviderCalled: false,
  scanned: {
    dataFiles: [
      { file: safeRel(libraryPath), exists: existsSync(libraryPath) },
      { file: safeRel(jobsPath), exists: existsSync(jobsPath) },
    ],
    uploadsRoot: safeRel(uploadsDir),
    uploadFileCount: uploadFiles.length,
  },
  counts: {
    libraryRecords: library.length,
    jobRecords: jobs.length,
    assetFiles: uploadFiles.length,
    mappableRecords: mappableRecords.length,
    missingFiles: missingFiles.length,
    orphanFiles: orphanFiles.length,
    duplicateRecords,
    conflictRecords: 0,
    estimatedLibraryItems: library.length,
    estimatedAssets: new Set(referencedNames).size,
    estimatedGenerationJobs: jobs.length,
  },
  suggestedImportOrder: [
    "assets",
    "generation_jobs",
    "library_items",
  ],
  riskLevel,
  allowRealImport: false,
  secrets: "masked",
};

console.log(JSON.stringify(report, null, 2));
