import assert from "node:assert/strict";
import { test } from "node:test";

import {
  getStage9cbDatabaseIntegrationFlags,
  shouldReadLibraryFromDatabase,
  shouldUseDatabaseJobs,
  shouldWriteLibraryToDatabase,
} from "../stage9cb-flags";

test("Stage 9C-B database integration flags fail closed by default", () => {
  const flags = getStage9cbDatabaseIntegrationFlags({});

  assert.equal(flags.libraryStorageBackend, "json");
  assert.equal(flags.generationJobsBackend, "existing");
  assert.equal(flags.databaseLibraryDualWrite, false);
  assert.equal(flags.databaseLibraryReadEnabled, false);
  assert.equal(flags.databaseJobsWriteEnabled, false);
  assert.equal(flags.databaseImportDryRunOnly, true);
  assert.equal(flags.databaseRuntimeAllowed, false);
  assert.equal(shouldReadLibraryFromDatabase(flags), false);
  assert.equal(shouldWriteLibraryToDatabase(flags), false);
  assert.equal(shouldUseDatabaseJobs(flags), false);
});

test("Stage 9C-B database integration flags require explicit database opt-in", () => {
  const flags = getStage9cbDatabaseIntegrationFlags({
    NODE_ENV: "test",
    LIBRARY_STORAGE_BACKEND: "database",
    GENERATION_JOBS_BACKEND: "database",
    DATABASE_LIBRARY_DUAL_WRITE: "true",
    DATABASE_LIBRARY_READ_ENABLED: "1",
    DATABASE_JOBS_WRITE_ENABLED: "yes",
    DATABASE_IMPORT_DRY_RUN_ONLY: "false",
  });

  assert.equal(flags.libraryStorageBackend, "database");
  assert.equal(flags.generationJobsBackend, "database");
  assert.equal(flags.databaseLibraryDualWrite, true);
  assert.equal(flags.databaseLibraryReadEnabled, true);
  assert.equal(flags.databaseJobsWriteEnabled, true);
  assert.equal(flags.databaseImportDryRunOnly, false);
  assert.equal(flags.databaseRuntimeAllowed, true);
  assert.equal(shouldReadLibraryFromDatabase(flags), true);
  assert.equal(shouldWriteLibraryToDatabase(flags), true);
  assert.equal(shouldUseDatabaseJobs(flags), true);
});

test("Stage 9C-B database integration ignores accidental production opt-in without runtime guard", () => {
  const flags = getStage9cbDatabaseIntegrationFlags({
    PORT: "3106",
    LIBRARY_STORAGE_BACKEND: "database",
    GENERATION_JOBS_BACKEND: "database",
    DATABASE_LIBRARY_DUAL_WRITE: "true",
    DATABASE_LIBRARY_READ_ENABLED: "true",
    DATABASE_JOBS_WRITE_ENABLED: "true",
  });

  assert.equal(flags.databaseRuntimeAllowed, false);
  assert.equal(shouldReadLibraryFromDatabase(flags), false);
  assert.equal(shouldWriteLibraryToDatabase(flags), false);
  assert.equal(shouldUseDatabaseJobs(flags), false);
});

test("Stage 9C-B database integration can be enabled on isolated 3107 only with strict storage", () => {
  const flags = getStage9cbDatabaseIntegrationFlags({
    PORT: "3107",
    RUNTIME_STORAGE_ISOLATION: "strict",
    DATA_DIR: "data-staging",
    UPLOADS_DIR: "uploads-staging",
    LIBRARY_STORAGE_BACKEND: "database",
    DATABASE_LIBRARY_READ_ENABLED: "true",
  });

  assert.equal(flags.databaseRuntimeAllowed, true);
  assert.equal(shouldReadLibraryFromDatabase(flags), true);
});

test("Stage 9C-B database integration invalid flag values fail closed", () => {
  const flags = getStage9cbDatabaseIntegrationFlags({
    NODE_ENV: "test",
    LIBRARY_STORAGE_BACKEND: "postgres",
    GENERATION_JOBS_BACKEND: "postgres",
    DATABASE_LIBRARY_DUAL_WRITE: "maybe",
    DATABASE_LIBRARY_READ_ENABLED: "enabled",
    DATABASE_JOBS_WRITE_ENABLED: "enabled",
  });

  assert.equal(flags.libraryStorageBackend, "json");
  assert.equal(flags.generationJobsBackend, "existing");
  assert.equal(flags.databaseLibraryDualWrite, false);
  assert.equal(flags.databaseLibraryReadEnabled, false);
  assert.equal(flags.databaseJobsWriteEnabled, false);
  assert.equal(shouldReadLibraryFromDatabase(flags), false);
  assert.equal(shouldWriteLibraryToDatabase(flags), false);
  assert.equal(shouldUseDatabaseJobs(flags), false);
});

test("Stage 9C-B library dual-write does not switch the read path by itself", () => {
  const flags = getStage9cbDatabaseIntegrationFlags({
    NODE_ENV: "test",
    DATABASE_LIBRARY_DUAL_WRITE: "true",
    DATABASE_LIBRARY_READ_ENABLED: "true",
  });

  assert.equal(shouldWriteLibraryToDatabase(flags), true);
  assert.equal(shouldReadLibraryFromDatabase(flags), false);
});
