# Stage 9E Staging Dual-Write Plan

This document is a plan-only handoff for a future 3107 staging dual-write
execution. It does not enable dual-write, switch read paths, change feature
flags, edit runtime environment files, write a database, run a migration,
perform backup/restore, read or import real uploads, call NewAPI/providers,
trigger generation, incur cost, or operate 3106.

## Current Safe Baseline

The current safe feature flag baseline must remain active until a separate
execution authorization is granted:

```text
LIBRARY_STORAGE_BACKEND=json
GENERATION_JOBS_BACKEND=existing
DATABASE_LIBRARY_DUAL_WRITE=false
DATABASE_LIBRARY_READ_ENABLED=false
DATABASE_JOBS_WRITE_ENABLED=false
DATABASE_IMPORT_DRY_RUN_ONLY=true
```

Stage 9E prerequisite status from the accepted closeouts:

- backup/restore closeout: PASS
- staging migration no-op closeout: PASS
- database feature flag review: PASS
- repo latest migration: `007_database_mvp_foundation`
- staging DB latest migration: `007_database_mvp_foundation`
- pending migrations: none
- MVP tables: exist and SELECT-readable

This plan does not re-connect to staging DB.

## Proposed 3107 Staging-Only Execution Sequence

The future execution sequence must be conservative and 3107-only:

1. Confirm 3107 process/env identity and confirm there is no 3106 target.
2. Confirm staging DB identity and migration status are still latest.
3. Keep read path on JSON/existing:
   - `LIBRARY_STORAGE_BACKEND=json`
   - `GENERATION_JOBS_BACKEND=existing`
   - `DATABASE_LIBRARY_READ_ENABLED=false`
4. After separate execution authorization, enable
   `DATABASE_LIBRARY_DUAL_WRITE=true` for 3107 only.
5. Run library dual-write smoke without provider calls, without NewAPI calls,
   without real generation, and without real uploads import.
6. If library smoke passes, consider the jobs DB write path. The current code
   requires both `GENERATION_JOBS_BACKEND=database` and
   `DATABASE_JOBS_WRITE_ENABLED=true` before jobs DB writes are active, so
   setting `DATABASE_JOBS_WRITE_ENABLED=true` alone is inert while
   `GENERATION_JOBS_BACKEND=existing`.
7. Run generation jobs DB write smoke only if the exact job-backend flag
   combination receives separate authorization. The smoke must use a safe
   non-provider fixture path and must not trigger real generation.
8. Run DB/file consistency checks.
9. Keep `DATABASE_LIBRARY_READ_ENABLED=false` until a separate read-path switch
   authorization exists.
10. Roll back to the safe baseline immediately if any mismatch, unexpected DB
    write, provider/NewAPI call, upload import, cost risk, or target ambiguity
    appears.

## Future Flag Candidates And Explicit Exclusions

Allowed future staging-only execution candidates after separate explicit
authorization:

```text
DATABASE_LIBRARY_DUAL_WRITE=true
DATABASE_JOBS_WRITE_ENABLED=true
```

Important code-path note:

- `DATABASE_LIBRARY_DUAL_WRITE=true` can enable library DB writes on 3107 when
  the runtime guard allows it.
- `DATABASE_JOBS_WRITE_ENABLED=true` does not activate jobs DB writes by itself.
  The current code also requires `GENERATION_JOBS_BACKEND=database`.

Explicitly not allowed without later authorization:

```text
DATABASE_LIBRARY_READ_ENABLED=true
LIBRARY_STORAGE_BACKEND=database
GENERATION_JOBS_BACKEND=database
DATABASE_IMPORT_DRY_RUN_ONLY=false
3106 changes
production DB changes
real uploads import
provider call
NewAPI call
real generation
cost-incurring action
```

## Required Pre-Execution Checks

Before any future execution, capture evidence for:

- worktree is clean
- `main` and `origin/main` are current and aligned
- target is 3107 staging only
- 3106 is excluded
- production DB is excluded
- staging DB identity is approved and non-production
- migration status is latest
- backup/restore closeout exists and remains accepted
- feature flag baseline is captured before change
- rollback environment values are prepared before change
- no provider call guard is active
- no NewAPI call guard is active
- no real uploads import guard is active
- no cost guard is active
- no secret, token, password, full DSN, or private runtime path will be printed

## Automated Validation Matrix

These commands exist today and should be used in the later execution packet
where applicable:

| Validation | Command | Purpose | Provider/NewAPI/cost boundary |
| --- | --- | --- | --- |
| Lint | `npm run lint` | Static code/style gate | No provider/NewAPI call |
| Type check | `npm run typecheck` | TypeScript gate | No provider/NewAPI call |
| Full local gate | `npm run check` | Existing aggregate CI gate | Existing checks report no generation/NewAPI/provider call |
| Stage 9D DB/file consistency fixture | `npm run db:consistency:check` | Existing temporary fixture consistency gate | No real uploads import |
| Stage 9C-B library consistency | `npm run db:library-consistency:check` | Existing read-only library/files consistency check | No DB write; no real import |
| Stage 2 UI acceptance | `npm run test:stage2-ui-acceptance` | Home/login/admin/library route and mode coverage | Guards forbidden generation/NewAPI requests |
| Stage 3 Studio regression | `npm run test:stage3-studio-regression` | Studio runtime regression and request guard | Guards forbidden generation/NewAPI requests |
| Studio API contracts | `npm run check:studio-api-contracts` | Static API contract guard | Reports generation/NewAPI not called |
| Staging smoke | `npm run test:staging-smoke` | 3107 smoke with temporary isolated runtime dirs | Reports generation APIs not called and NewAPI quota not consumed |
| Runtime isolation | `npm run test:runtime-isolation` | Storage isolation guard | No provider/NewAPI call |
| Release artifact isolation | `npm run check:release-test-artifact-isolation` | Confirms release/test artifact separation | No provider/NewAPI call |

Required but not currently represented by a dedicated npm script:

- library dual-write smoke after the staging-only flag change
- generation jobs DB write smoke after separately authorized job-backend flags
- no provider/NewAPI/cost assertion over the actual 3107 execution window
- no real uploads import assertion over the actual 3107 execution window
- rollback smoke confirming DB writes stop after flags return to baseline

Those items must be run as manual/Codex checks or added as future scripts in a
separate docs/code authorization. This plan does not add scripts.

## Smoke Test Design

Future staging smoke tests must be scoped to 3107 only.

### Library Write Path Smoke

- Confirm baseline before change.
- Enable `DATABASE_LIBRARY_DUAL_WRITE=true` for 3107 only after separate
  authorization.
- Use a safe staging-only library mutation path that does not call generation,
  provider endpoints, NewAPI, or upload import.
- Confirm JSON remains the read path.
- Confirm corresponding DB rows are created or updated only in the approved
  staging DB.
- Confirm no real upload file is read, imported, moved, deleted, or modified.

### Generation Job Write Path Smoke

- Do not run by default.
- First confirm whether separate authorization includes
  `GENERATION_JOBS_BACKEND=database`; without it,
  `DATABASE_JOBS_WRITE_ENABLED=true` alone is not expected to write jobs.
- Use a safe non-provider fixture job record only.
- Confirm no real generation, provider polling, NewAPI request, or cost occurs.
- Confirm DB write evidence only if the required backend flag combination is
  explicitly authorized.

### DB Consistency Check

- Run existing consistency checks.
- Compare JSON and DB evidence for the smoke scope only.
- Stop on any mismatch, orphan, unsafe path, unexpected upload reference, or DB
  identity ambiguity.

### No Provider / No Uploads / No Cost Assertions

The execution report must show:

```text
No real NewAPI/provider call.
No real generation.
No real uploads import.
No 3106.
No cost incurred.
```

### Rollback Smoke

- Revert 3107-only flags to the safe baseline.
- Restart/reload 3107 only if separately authorized.
- Verify health after rollback.
- Verify DB writes no longer continue after rollback.
- Do not touch 3106.

## Rollback Plan

The exact rollback target is:

```text
LIBRARY_STORAGE_BACKEND=json
GENERATION_JOBS_BACKEND=existing
DATABASE_LIBRARY_DUAL_WRITE=false
DATABASE_LIBRARY_READ_ENABLED=false
DATABASE_JOBS_WRITE_ENABLED=false
DATABASE_IMPORT_DRY_RUN_ONLY=true
```

Rollback requirements:

- Revert env flags for 3107 only.
- Do not modify 3106 env, service, data, uploads, or release artifacts.
- Restart/reload 3107 only if later authorized.
- Verify `/api/health/backend`, home, login, and library after rollback.
- Verify JSON/existing paths are active after rollback.
- Verify no DB writes continue after rollback.
- Keep rollback report free of secrets, tokens, passwords, full DSNs, and
  private runtime paths.

## Stop Conditions

Stop immediately if any of these appears:

- production DB signal
- 3106 signal
- migration not latest
- backup/restore closeout missing or disputed
- DB identity unclear
- DB write error
- dual-write mismatch
- JSON vs DB consistency mismatch
- provider call needed
- real uploads import needed
- NewAPI/provider attempted
- real generation attempted
- cost risk
- missing rollback path
- secret exposure
- uncertainty about target environment
- need to switch read path to continue
- need to run migration to continue
- need to write production DB to continue

## Future Execution Packet Template

After a separately authorized staging dual-write execution, Codex must report:

```text
3107_TARGET_CONFIRMED=yes/no
3106_EXCLUDED=yes/no
PRODUCTION_DB_EXCLUDED=yes/no
STAGING_DB_CONFIRMED=yes/no
FLAGS_CHANGED=
FLAGS_NOT_CHANGED=
VALIDATION_COMMANDS_RUN=
LIBRARY_DUAL_WRITE_SMOKE=pass/fail/not-run
JOBS_DB_WRITE_SMOKE=pass/fail/not-run
DB_CONSISTENCY_CHECK=pass/fail/not-run
NO_PROVIDER_CALL_CONFIRMED=yes/no
NO_UPLOADS_IMPORT_CONFIRMED=yes/no
NO_COST_CONFIRMED=yes/no
ROLLBACK_REQUIRED=yes/no
ROLLBACK_COMPLETED=yes/no/not-needed
```

## Next-Stage Recommendation

```text
READY_FOR_STAGING_DUAL_WRITE_EXECUTION=yes, requires separate explicit authorization
READY_FOR_DATABASE_READ_PATH_SWITCH=no
READY_FOR_3106_OPERATION=no
```

This plan supports requesting a future staging dual-write execution
authorization. It does not authorize execution, database read-path switching,
production DB access, real uploads import, provider/NewAPI calls, generation,
cost, or any 3106 operation.

## Plan-Only Safety Closeout

- 3106 was not touched.
- Production DB was not connected.
- Staging DB was not written.
- Production DB was not written.
- Migration was not run.
- Backup/restore was not run.
- `pg_dump` and `pg_restore` were not run.
- Real uploads were not read, imported, moved, deleted, or modified.
- Dual-write was not enabled.
- Read path was not switched.
- Feature flags were not changed.
- `.runtime` real running env was not modified.
- NewAPI/provider was not called.
- Real generation was not triggered.
- No cost was incurred.
- Staging dual-write execution was not entered.
