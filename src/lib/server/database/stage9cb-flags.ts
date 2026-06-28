import "server-only";

export type Stage9cbLibraryStorageBackend = "json" | "database";
export type Stage9cbGenerationJobsBackend = "existing" | "database";

export type Stage9cbDatabaseIntegrationFlags = {
  libraryStorageBackend: Stage9cbLibraryStorageBackend;
  generationJobsBackend: Stage9cbGenerationJobsBackend;
  databaseLibraryDualWrite: boolean;
  databaseLibraryReadEnabled: boolean;
  databaseJobsWriteEnabled: boolean;
  databaseImportDryRunOnly: boolean;
  databaseRuntimeAllowed: boolean;
};

type Stage9cbEnv = Record<string, string | undefined>;

function normalized(value: string | undefined) {
  return String(value || "").trim().toLowerCase();
}

function booleanFlag(value: string | undefined) {
  return ["1", "true", "yes", "on"].includes(normalized(value));
}

function libraryBackend(value: string | undefined): Stage9cbLibraryStorageBackend {
  return normalized(value) === "database" ? "database" : "json";
}

function jobsBackend(value: string | undefined): Stage9cbGenerationJobsBackend {
  return normalized(value) === "database" ? "database" : "existing";
}

function databaseRuntimeAllowed(env: Stage9cbEnv) {
  if (env.NODE_ENV === "test") return true;
  return env.PORT?.trim() === "3107"
    && env.RUNTIME_STORAGE_ISOLATION?.trim() === "strict"
    && Boolean(env.DATA_DIR?.trim())
    && Boolean(env.UPLOADS_DIR?.trim());
}

export function getStage9cbDatabaseIntegrationFlags(env: Stage9cbEnv = process.env): Stage9cbDatabaseIntegrationFlags {
  return {
    libraryStorageBackend: libraryBackend(env.LIBRARY_STORAGE_BACKEND),
    generationJobsBackend: jobsBackend(env.GENERATION_JOBS_BACKEND),
    databaseLibraryDualWrite: booleanFlag(env.DATABASE_LIBRARY_DUAL_WRITE),
    databaseLibraryReadEnabled: booleanFlag(env.DATABASE_LIBRARY_READ_ENABLED),
    databaseJobsWriteEnabled: booleanFlag(env.DATABASE_JOBS_WRITE_ENABLED),
    databaseImportDryRunOnly: normalized(env.DATABASE_IMPORT_DRY_RUN_ONLY) === "false" ? false : true,
    databaseRuntimeAllowed: databaseRuntimeAllowed(env),
  };
}

export function shouldReadLibraryFromDatabase(flags = getStage9cbDatabaseIntegrationFlags()) {
  return flags.databaseRuntimeAllowed && flags.libraryStorageBackend === "database" && flags.databaseLibraryReadEnabled;
}

export function shouldWriteLibraryToDatabase(flags = getStage9cbDatabaseIntegrationFlags()) {
  return flags.databaseRuntimeAllowed && (flags.libraryStorageBackend === "database" || flags.databaseLibraryDualWrite);
}

export function shouldUseDatabaseJobs(flags = getStage9cbDatabaseIntegrationFlags()) {
  return flags.databaseRuntimeAllowed && flags.generationJobsBackend === "database" && flags.databaseJobsWriteEnabled;
}
