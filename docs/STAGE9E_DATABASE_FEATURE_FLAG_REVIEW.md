# Stage 9E Database Feature Flag Review

This document is a review-only closeout for the database-related feature flags
that gate the Stage 9C-B library and generation job database adapters.

No feature flag is enabled by this review. No database connection, migration,
backup, restore, upload import, provider call, NewAPI call, generation call, or
3106 operation is required by this document.

## Review Inputs

- Source code:
  - `src/lib/server/database/stage9cb-flags.ts`
  - `src/lib/server/library.ts`
  - `src/lib/server/database/library-jobs-adapter.ts`
- Tests:
  - `src/lib/server/database/__tests__/stage9cb-flags.test.ts`
  - `src/lib/server/database/__tests__/library-jobs-adapter.test.ts`
- Existing documentation:
  - `docs/DATABASE_STAGE9CB_INTEGRATION.md`
  - `docs/LIBRARY_DATABASE_BACKEND.md`
  - `docs/GENERATION_JOBS_DATABASE_BACKEND.md`
  - `docs/STAGE9F_P0_SECURITY_BASELINE_AUDIT.md`
- Non-secret configuration template:
  - `.env.example`
- Package scripts:
  - `package.json`

The current Stage 9E operational status was provided by the owner/supervisor:
staging migration status is latest, repo latest migration is
`007_database_mvp_foundation`, DB latest migration is
`007_database_mvp_foundation`, pending migrations are none, and MVP tables exist
and are SELECT-readable. This review did not re-connect to staging DB.

## Current Safe Baseline

The safe baseline remains:

```text
LIBRARY_STORAGE_BACKEND=json
GENERATION_JOBS_BACKEND=existing
DATABASE_LIBRARY_DUAL_WRITE=false
DATABASE_LIBRARY_READ_ENABLED=false
DATABASE_JOBS_WRITE_ENABLED=false
DATABASE_IMPORT_DRY_RUN_ONLY=true
```

The code is fail-closed:

- `LIBRARY_STORAGE_BACKEND` becomes `database` only when explicitly set to
  `database`; otherwise it resolves to `json`.
- `GENERATION_JOBS_BACKEND` becomes `database` only when explicitly set to
  `database`; otherwise it resolves to `existing`.
- Boolean flags are true only for `1`, `true`, `yes`, or `on`.
- `DATABASE_IMPORT_DRY_RUN_ONLY` defaults to true unless explicitly set to
  `false`.
- Database runtime is allowed only in tests, or when the runtime is isolated
  with `PORT=3107`, `RUNTIME_STORAGE_ISOLATION=strict`, `DATA_DIR`, and
  `UPLOADS_DIR`.

## Feature Flag Inventory

| FLAG_NAME | DEFAULT_VALUE | CURRENT_TEMPLATE_VALUE | CODE_PATHS_AFFECTED | WRITE_RISK | READ_RISK | ROLLBACK_VALUE |
| --- | --- | --- | --- | --- | --- | --- |
| `LIBRARY_STORAGE_BACKEND` | `json` | Not set in `.env.example`; default documented as `json` | Parsed by `stage9cb-flags.ts`; gates `shouldReadLibraryFromDatabase` and contributes to `shouldWriteLibraryToDatabase`; affects `readLibrary`, `addLibraryItem`, `updateLibraryItem`, and `deleteLibraryItem` through `src/lib/server/library.ts` | If set to `database` in an allowed runtime, library item writes can also write to `assets`, `library_items`, and related `generation_jobs` via the adapter | If combined with `DATABASE_LIBRARY_READ_ENABLED=true`, reads switch from JSON to DB | `json` |
| `GENERATION_JOBS_BACKEND` | `existing` | Not set in `.env.example`; default documented as `existing` | Parsed by `stage9cb-flags.ts`; gates `shouldUseDatabaseJobs`; affects `readJobs`, `addJob`, and `updateJob` through `src/lib/server/library.ts` | If set to `database` with `DATABASE_JOBS_WRITE_ENABLED=true` in an allowed runtime, generation job records can write to `generation_jobs` and job reference assets | If set to `database` with `DATABASE_JOBS_WRITE_ENABLED=true`, job polling reads can come from DB adapter output | `existing` |
| `DATABASE_LIBRARY_DUAL_WRITE` | `false` | Not set in `.env.example`; default documented as `false` | Parsed by `stage9cb-flags.ts`; contributes to `shouldWriteLibraryToDatabase`; affects library add/update/delete paths in `src/lib/server/library.ts` | When true in an allowed runtime, JSON stays primary but library mutations also write/soft-delete DB rows | Does not switch reads by itself | `false` |
| `DATABASE_LIBRARY_READ_ENABLED` | `false` | Not set in `.env.example`; default documented as `false` | Parsed by `stage9cb-flags.ts`; gates `shouldReadLibraryFromDatabase`; affects `readLibrary` and DB-mode delete behavior in `src/lib/server/library.ts` | Does not cause DB writes by itself, but DB-mode delete soft-deletes in the DB path when reads are enabled | Switches library reads from JSON to DB only when `LIBRARY_STORAGE_BACKEND=database` and runtime guard allows it | `false` |
| `DATABASE_JOBS_WRITE_ENABLED` | `false` | Not set in `.env.example`; default documented as `false` | Parsed by `stage9cb-flags.ts`; gates `shouldUseDatabaseJobs`; affects `readJobs`, `addJob`, and `updateJob` in `src/lib/server/library.ts` | When true with `GENERATION_JOBS_BACKEND=database` in an allowed runtime, generation jobs are written/updated in DB | Also causes job reads to use the DB adapter under the same gate | `false` |
| `DATABASE_IMPORT_DRY_RUN_ONLY` | `true` | Not set in `.env.example`; default documented as `true` | Parsed by `stage9cb-flags.ts`; import tooling documents dry-run-only behavior; `scripts/database/plan-library-import.mjs` rejects `--apply` | Keeping true prevents real import execution. Explicit false must remain blocked until a separately authorized import stage exists | No application read-path effect | `true` |

## Conservative Staging Dual-Write Plan

This is a plan only. It is not authorization to execute.

1. Keep reads on JSON/existing:
   - `LIBRARY_STORAGE_BACKEND=json`
   - `GENERATION_JOBS_BACKEND=existing`
   - `DATABASE_LIBRARY_READ_ENABLED=false`
2. After separate authorization, enable `DATABASE_LIBRARY_DUAL_WRITE=true` in
   staging only, on isolated 3107 only.
3. Enable `DATABASE_JOBS_WRITE_ENABLED=true` in staging only if the job write path
   is explicitly ready. This should be paired with
   `GENERATION_JOBS_BACKEND=database` only after the staging job smoke evidence
   is available.
4. Run automated staging smoke and consistency checks before considering any
   read-path change.
5. Only after evidence, consider `LIBRARY_STORAGE_BACKEND=database` plus
   `DATABASE_LIBRARY_READ_ENABLED=true` in staging.
6. Never touch 3106 without separate release authorization.

## Stop Conditions

Stop before any execution if any of these conditions is true:

- DB identity is unclear.
- A production signal is present.
- A 3106 signal is present.
- Migration status is not latest.
- Backup/restore evidence is missing.
- Any planned write fails.
- Dual-write output mismatches JSON state.
- JSON and DB consistency checks mismatch.
- A provider call would be required.
- A NewAPI call would be required.
- A real uploads import would be required.
- Any upload move/delete/modify would be required.
- Any cost risk appears.
- Rollback path is missing or untested.
- Secrets, tokens, passwords, full DSNs, or private runtime paths would need to
  be exposed.

## Rollback Plan

Rollback is flag-only unless a later separately authorized execution stage
requires additional service recovery steps.

| Flag | Rollback value | Expected effect |
| --- | --- | --- |
| `LIBRARY_STORAGE_BACKEND` | `json` | Library reads return to `data/library.json`; DB library read path is disabled. |
| `GENERATION_JOBS_BACKEND` | `existing` | Generation job reads and writes return to the existing job store. |
| `DATABASE_LIBRARY_DUAL_WRITE` | `false` | Library mutations stop writing to DB while JSON remains primary. |
| `DATABASE_LIBRARY_READ_ENABLED` | `false` | Library reads stop using DB even if other DB flags are present. |
| `DATABASE_JOBS_WRITE_ENABLED` | `false` | Generation job DB writes and DB reads stop under `shouldUseDatabaseJobs`. |
| `DATABASE_IMPORT_DRY_RUN_ONLY` | `true` | Import planning remains dry-run-only; real import remains blocked. |

The complete rollback baseline is:

```text
LIBRARY_STORAGE_BACKEND=json
GENERATION_JOBS_BACKEND=existing
DATABASE_LIBRARY_DUAL_WRITE=false
DATABASE_LIBRARY_READ_ENABLED=false
DATABASE_JOBS_WRITE_ENABLED=false
DATABASE_IMPORT_DRY_RUN_ONLY=true
```

## Required Automated Validation Before Execution

Before any later staging dual-write execution, run and retain evidence for:

- `npm run lint`
- `npm run typecheck`
- `npm run check`
- `npm run test:stage2-ui-acceptance`
- `npm run test:stage3-studio-regression`
- `npm run db:library-consistency:check`
- Library dual-write smoke on staging 3107 only.
- Generation jobs DB write smoke on staging 3107 only, if the job DB path is in
  scope.
- No provider call assertion.
- No NewAPI call assertion.
- No uploads import assertion.
- No upload move/delete/modify assertion.
- Runtime guard evidence showing staging 3107 only and strict storage isolation.

The existing dry-run scripts reject `--apply` in this stage:

- `scripts/database/plan-library-import.mjs`
- `scripts/database/check-library-db-file-consistency.mjs`

## Next-Stage Recommendation

```text
READY_FOR_STAGING_DUAL_WRITE_PLAN=yes
READY_FOR_STAGING_DUAL_WRITE_EXECUTION=no, requires separate authorization
READY_FOR_3106_OPERATION=no
```

## Review-Only Safety Closeout

- No feature flag was changed.
- Dual-write was not enabled.
- Read path was not switched.
- No production DB connection was made.
- No staging DB write was made.
- No migration was run.
- No backup or restore was executed.
- No `pg_dump` or `pg_restore` was executed.
- Real uploads were not read, imported, moved, deleted, or modified.
- No NewAPI/provider call was made.
- No real generation was triggered.
- No cost was incurred.
- 3106 was not operated.
