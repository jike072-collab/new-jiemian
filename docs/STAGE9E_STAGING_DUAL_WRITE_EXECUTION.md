# Stage 9E Staging Dual-Write Execution

Status: PARTIAL

Date: 2026-06-29
Worktree: `new-jiemian-3107`
Base commit: `d7cdee5c68ba4c500054b44193d6ea09a60734da`
Scope: 3107 staging only

## Authorization Boundary

This run was authorized only for short-lived 3107 staging dual-write shadow execution.

Allowed temporary runtime flags:

- `DATABASE_LIBRARY_DUAL_WRITE=true`
- `DATABASE_JOBS_WRITE_ENABLED=true`

Required preserved runtime flags:

- `LIBRARY_STORAGE_BACKEND=json`
- `GENERATION_JOBS_BACKEND=existing`
- `DATABASE_LIBRARY_READ_ENABLED=false`
- `DATABASE_IMPORT_DRY_RUN_ONLY=true`

Explicitly out of scope:

- 3106 operation
- production DB connection or write
- staging or production migration
- database read-path switch
- real uploads import
- provider or NewAPI calls
- real generation
- cost-incurring operations
- PR merge without separate authorization

## Preflight Summary

Git/worktree gate passed:

- Branch before execution: `main`
- `HEAD`: `d7cdee5c68ba4c500054b44193d6ea09a60734da`
- `origin/main`: `d7cdee5c68ba4c500054b44193d6ea09a60734da`
- `origin/main...main`: `0 0`
- Worktree: clean

3107 baseline service gate passed:

- Service: staging / 3107
- Runtime commit before aligned execution: `d7cdee5c68ba4c500054b44193d6ea09a60734da`
- `commitsMatch`: true after restart alignment
- Health: OK
- `/api/health/backend`: 200
- Home: 200
- Library API: 200
- `newApiCalled=false`

Baseline flags before execution:

- `LIBRARY_STORAGE_BACKEND=json`
- `GENERATION_JOBS_BACKEND=existing`
- `DATABASE_LIBRARY_DUAL_WRITE=false`
- `DATABASE_LIBRARY_READ_ENABLED=false`
- `DATABASE_JOBS_WRITE_ENABLED=false`
- `DATABASE_IMPORT_DRY_RUN_ONLY=true`

## Staging DB Readiness

Only staging DB was connected. The report intentionally excludes complete DSNs, passwords, and tokens.

- Host summary: loopback
- Port: 5432
- Database: `aohuang_app`
- Expected DB name matched: yes
- Production signal: no
- Current user: staging runtime role
- Schema: `public`
- PostgreSQL version: 16.14
- `schema_migrations`: readable
- Latest migration: `007_database_mvp_foundation`

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

The tables needed for this smoke had the required staging write privileges:

- `assets`: SELECT / INSERT / UPDATE available
- `library_items`: SELECT / INSERT / UPDATE available
- `generation_jobs`: SELECT / INSERT / UPDATE available

Important caveat: the staging runtime connection role currently has elevated role attributes and broad privileges. This execution did not change role grants or DB privileges.

## Shadow-Mode Activation

3107 was restarted only for staging with temporary process-environment flags:

- `DATABASE_LIBRARY_DUAL_WRITE=true`
- `DATABASE_JOBS_WRITE_ENABLED=true`
- `RUNTIME_STORAGE_ISOLATION=strict`

The persistent `.runtime/staging.env` file was not edited.

Effective runtime gate during smoke:

- `databaseRuntimeAllowed=true`
- `shouldWriteLibraryToDatabase=true`
- `shouldReadLibraryFromDatabase=false`
- `shouldUseDatabaseJobs=false`

The read path stayed JSON/existing throughout the run.

## Smoke Result

Fixture strategy:

- Used a no-provider fixture library item.
- Did not call image/video generation APIs.
- Did not call provider status polling.
- Did not use `output.storedName`.
- Did not read, import, move, delete, or modify real uploads.
- Fixture was deleted after the write check.

Fixture ID:

- `dd5e0e02-1b5b-47d1-ac40-cd80ac7f98ae`

Library dual-write result:

- JSON path accepted the fixture during add.
- DB shadow row was created in `library_items`.
- DB shadow asset row was created in `assets`.
- Delete cleanup removed the JSON fixture.
- DB cleanup used soft delete:
  - `library_items.is_deleted=true`
  - `deleted_at` present
- Staging `data-staging` was restored to an empty directory after cleanup.
- Staging `uploads-staging` remained empty.

DB verification summary:

- `library_items` fixture row: found
- `library_items.is_deleted`: true after cleanup
- `assets` rows for fixture: 1
- `generation_jobs` rows for fixture: 0

## Generation Jobs Caveat

Generation jobs DB runtime write was not activated.

Reason:

- The code gates jobs DB usage through `shouldUseDatabaseJobs()`.
- `shouldUseDatabaseJobs()` requires `GENERATION_JOBS_BACKEND=database`.
- This run was explicitly required to keep `GENERATION_JOBS_BACKEND=existing`.

Therefore `DATABASE_JOBS_WRITE_ENABLED=true` was inert by design under the authorized flags. No database read-path or jobs backend switch was performed.

## Rollback Result

After smoke, 3107 was restarted back to the persisted baseline environment.

Post-rollback flags:

- `LIBRARY_STORAGE_BACKEND=json`
- `GENERATION_JOBS_BACKEND=existing`
- `DATABASE_LIBRARY_DUAL_WRITE=false`
- `DATABASE_LIBRARY_READ_ENABLED=false`
- `DATABASE_JOBS_WRITE_ENABLED=false`
- `DATABASE_IMPORT_DRY_RUN_ONLY=true`

Post-rollback service:

- 3107 listening: yes
- Runtime commit: `d7cdee5c68ba4c500054b44193d6ea09a60734da`
- `commitsMatch=true`
- Health: OK
- Home: 200
- Library API: 200
- `newApiCalled=false`

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
- `DATABASE_IMPORT_DRY_RUN_ONLY` not disabled
- NewAPI/provider not called
- Real generation not triggered
- No cost incurred
- `.runtime` secrets not committed

## Conclusion

`Stage 9E staging dual-write execution: PARTIAL`

Library dual-write shadow mode succeeded on 3107 staging and was rolled back to baseline.

Generation jobs DB runtime write remains unverified because the authorized boundary required `GENERATION_JOBS_BACKEND=existing`, which keeps the jobs DB path disabled by design.

Recommended next step: a separate authorization should decide whether to run a sustained 3107 dual-write observation window and whether a later jobs DB smoke may temporarily set `GENERATION_JOBS_BACKEND=database`.

Database read path switch remains forbidden without separate user authorization.

3106 operation remains forbidden without separate user authorization.
