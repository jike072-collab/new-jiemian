# Stage 9E-S1 Library Dual-Write Observation

Status: PASS

Date: 2026-06-29
Worktree: `new-jiemian-3107`
Base commit: `65427acc866ee824a927d8c7662439fdc2e638a3`
Scope: 3107 staging only

## Authorization Boundary

This run was authorized only for 3107 staging sustained library dual-write
shadow observation setup.

Allowed temporary runtime flag:

- `DATABASE_LIBRARY_DUAL_WRITE=true`

Required preserved runtime flags:

- `DATABASE_LIBRARY_READ_ENABLED=false`
- `LIBRARY_STORAGE_BACKEND=json`
- `GENERATION_JOBS_BACKEND=existing`
- `DATABASE_JOBS_WRITE_ENABLED=false`
- `DATABASE_IMPORT_DRY_RUN_ONLY=true`

The run also kept `RUNTIME_STORAGE_ISOLATION=strict` as the 3107 staging
runtime safety guard required by the application before database shadow writes
can be active.

Explicitly out of scope:

- 3106 operation
- production DB connection or write
- staging or production migration
- database read-path switch
- `GENERATION_JOBS_BACKEND=database`
- generation jobs DB runtime write observation
- real uploads read, import, move, delete, or modification
- provider or NewAPI calls
- real generation
- cost-incurring operations
- backup or restore
- PR merge without separate authorization

## Worktree Gate

Git/worktree gate passed before setup:

- Branch before setup: `main`
- `HEAD`: `65427acc866ee824a927d8c7662439fdc2e638a3`
- `main`: `65427acc866ee824a927d8c7662439fdc2e638a3`
- `origin/main`: `65427acc866ee824a927d8c7662439fdc2e638a3`
- `origin/main...main`: `0 0`
- Worktree: clean

## Baseline 3107 Preflight

3107 baseline service gate passed before observation setup:

- Service: staging / 3107
- Listening: yes
- Baseline PID before restart: `34376`
- Workspace commit: `65427acc866ee824a927d8c7662439fdc2e638a3`
- Runtime commit before restart: `d7cdee5c68ba4c500054b44193d6ea09a60734da`
- Baseline health: OK
- `/api/health/backend`: 200
- Home: 200
- Login: 200
- Library API: 200
- `newApiCalled=false`

Baseline persisted runtime flags before the temporary observation restart:

- `DATABASE_LIBRARY_DUAL_WRITE=false`
- `DATABASE_LIBRARY_READ_ENABLED=false`
- `LIBRARY_STORAGE_BACKEND=json`
- `GENERATION_JOBS_BACKEND=existing`
- `DATABASE_JOBS_WRITE_ENABLED=false`
- `DATABASE_IMPORT_DRY_RUN_ONLY=true`

## Staging DB Read-Only Readiness

Only the 3107 staging DB was connected. The readiness query ran inside a
read-only transaction and the report intentionally excludes complete DSNs,
passwords, and tokens.

- Host summary: loopback
- Port: 5432
- Database: `aohuang_app`
- Expected DB name matched: yes
- Production signal: no
- Current user: staging runtime role
- Schema: `public`
- PostgreSQL version: 16.14
- Transaction read-only: on
- `schema_migrations`: readable
- Latest migration: `007_database_mvp_foundation`
- Applied migration count: 7

Required MVP tables existed:

- `generation_jobs`
- `assets`
- `library_items`
- `provider_model_snapshots`
- `api_call_logs`
- `error_events`
- `audit_logs`
- `quota_accounts`
- `quota_ledger`

## Observation Activation

3107 was restarted only for staging with temporary process-environment flags.
The persistent `.runtime/staging.env` file was not edited.

Observation PID after restart:

- PID: `53968`
- Runtime commit: `65427acc866ee824a927d8c7662439fdc2e638a3`
- `commitsMatch=true`

Effective observation gates:

- `databaseRuntimeAllowed=true`
- `shouldWriteLibraryToDatabase=true`
- `shouldReadLibraryFromDatabase=false`
- `shouldUseDatabaseJobs=false`

Effective observation flags:

- `DATABASE_LIBRARY_DUAL_WRITE=true`
- `DATABASE_LIBRARY_READ_ENABLED=false`
- `LIBRARY_STORAGE_BACKEND=json`
- `GENERATION_JOBS_BACKEND=existing`
- `DATABASE_JOBS_WRITE_ENABLED=false`
- `DATABASE_IMPORT_DRY_RUN_ONLY=true`
- `RUNTIME_STORAGE_ISOLATION=strict`

The read path stayed JSON/existing throughout the run. Database writes were
used only as library shadow writes.

## Fixture Smoke Result

Fixture strategy:

- Used a no-provider fixture library item.
- Did not call image/video generation APIs.
- Did not call provider status polling.
- Did not call NewAPI.
- Did not use `output.storedName`.
- Did not read, import, move, delete, or modify real uploads.
- Fixture was deleted from JSON after the write check.

Fixture ID:

- `a8c4da51-7078-4c92-be30-38eb5bb4579e`

Library dual-write result:

- JSON path accepted the fixture during add.
- DB shadow row was created in `library_items`.
- DB shadow asset row was created in `assets`.
- Delete cleanup removed the JSON fixture.
- DB cleanup used soft delete:
  - `library_items.is_deleted=true`
  - `deleted_at` present

DB verification summary:

- `library_items` fixture row: found
- `assets` rows for fixture: 1
- `generation_jobs` rows for fixture prompt: 0

Generation jobs DB runtime write was not tested and was not enabled.

## Current Observation State

3107 remains in sustained library dual-write shadow observation state:

- Service: staging / 3107
- Listening: yes
- PID: `53968`
- Health: OK
- `/api/health/backend`: 200
- Home: 200
- Login: 200
- Library API: 200
- `newApiCalled=false`
- Workspace commit: `65427acc866ee824a927d8c7662439fdc2e638a3`
- Runtime commit: `65427acc866ee824a927d8c7662439fdc2e638a3`
- `commitsMatch=true`

Current observation flags:

- `DATABASE_LIBRARY_DUAL_WRITE=true`
- `DATABASE_LIBRARY_READ_ENABLED=false`
- `LIBRARY_STORAGE_BACKEND=json`
- `GENERATION_JOBS_BACKEND=existing`
- `DATABASE_JOBS_WRITE_ENABLED=false`
- `DATABASE_IMPORT_DRY_RUN_ONLY=true`
- `RUNTIME_STORAGE_ISOLATION=strict`

Observation started after the 3107 staging restart on 2026-06-29. The scope is
library JSON-primary writes with DB shadow writes on 3107 staging only.

## Rollback Plan

Rollback requires a separate 3107-only authorization if this observation should
be stopped.

Minimal rollback target flags:

- `DATABASE_LIBRARY_DUAL_WRITE=false`
- `DATABASE_LIBRARY_READ_ENABLED=false`
- `LIBRARY_STORAGE_BACKEND=json`
- `GENERATION_JOBS_BACKEND=existing`
- `DATABASE_JOBS_WRITE_ENABLED=false`
- `DATABASE_IMPORT_DRY_RUN_ONLY=true`

After rollback, verify:

- 3107 listening
- `/api/health/backend`: 200
- Home: 200
- Library API: 200
- `newApiCalled=false`
- `shouldWriteLibraryToDatabase=false`
- `shouldReadLibraryFromDatabase=false`
- `shouldUseDatabaseJobs=false`

Rollback must not operate 3106, must not connect production DB, must not run
migrations, must not switch read path, and must not call NewAPI or providers.

## Safety Confirmation

- 3106 not touched
- Production DB not connected
- Production DB not written
- Staging migration not run
- Production migration not run
- Real uploads not read, imported, moved, deleted, or modified
- Database read path not switched
- `LIBRARY_STORAGE_BACKEND` not switched to `database`
- `GENERATION_JOBS_BACKEND` not switched to `database`
- `DATABASE_LIBRARY_READ_ENABLED` not enabled
- `DATABASE_JOBS_WRITE_ENABLED` not enabled
- `DATABASE_IMPORT_DRY_RUN_ONLY` not disabled
- NewAPI/provider not called
- Real generation not triggered
- No cost incurred
- Backup/restore not executed
- `.runtime` secrets not committed

## Conclusion

`Stage 9E-S1 library dual-write observation: PASS`

3107 staging is now in sustained library dual-write shadow observation with JSON
remaining the read path and primary storage path. The fixture smoke verified
JSON write and cleanup, DB shadow writes to `assets` and `library_items`, and DB
soft-delete cleanup. Generation jobs DB backend and database read path remained
disabled.

Database read path switch remains forbidden without separate user authorization.

Generation jobs DB observation remains forbidden without separate user
authorization.

3106 operation remains forbidden without separate user authorization.
