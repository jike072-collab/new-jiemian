# Database Stage 9C Preconditions

Stage 9C may start only after separate user authorization. This document lists
the required preconditions before any minimum database implementation begins.

## Required Decisions

- Migration tool: continue `scripts/database/migrate.mjs` unless separately
  changed.
- Schema file location: raw SQL migration files under `db/migrations`.
- Migration directory: `db/migrations`.
- First-batch tables: `generation_jobs`, `assets`, `library_items`,
  `api_call_logs`, `error_events`.
- Deferred tables: users, sessions, auth accounts, quota, orders, payments,
  provider secret storage, system settings, full audit logs, full deleted items.

## Database Targets

Before Stage 9C runs any database command, the operator must identify the target:

- throwaway test database
- `3107` staging database
- production database

Stage 9C should start with a throwaway test database. Staging migration requires
separate authorization. Production migration is forbidden in Stage 9C unless a
new user instruction explicitly expands the scope and names the release target.

## Connection Safety

- Test DB connection must be disposable or throwaway.
- Staging DB connection must be separate from production.
- Production DB connection is read/write prohibited by default.
- `APP_DATABASE_URL` and `APP_DATABASE_EXPECTED_NAME` must be configured only in
  the intended environment.
- Reports must show only `configured/masked`, `missing`, `present_not_read`, or
  `not_found`.
- CI must not connect to production DB.
- CI must not run production migration.
- Build and check scripts must not implicitly write DB.

## Backup And Restore Gate

Before any staging or production migration is authorized:

- PostgreSQL backup command must be defined.
- `pg_dump` custom-format backup must be available for production releases.
- `pg_restore --list` verification must be part of the backup check.
- Backup location must be outside Git.
- Backup file naming must include environment, commit or deployment id, and
  timestamp.
- Backup readability must be verified before migration.
- Restore rehearsal must target a disposable database, never production.
- Migration failure must stop release immediately.
- A separate backup is required before any later `3106` publish.
- `data` and `uploads` snapshots/checksums must be recorded with the matching DB
  backup set.
- A database backup does not cover `uploads`; file backups are separate.
- DB/file consistency risk must be acknowledged before any data migration.

## Rollback Strategy

Stage 9C must document:

- how to stop after failed migration
- how to verify migration status
- how to restore the database from the matching backup
- how to restore `data/uploads` only when file state was part of the change
- how to validate service health after rollback
- who authorized rollback execution

Stage 9C must not rely on expired rollback authorization.

## Data And Uploads Boundary

- `3106` production `data/uploads` must remain unchanged.
- `3107` `data-staging/uploads-staging` must remain unchanged unless the user
  explicitly authorizes a staging data migration.
- JSON migration is deferred by default.
- Any JSON migration must have a separate dry-run, count-only comparison, and
  rollback plan.
- Tests must use temporary directories or fixtures and must not pollute real
  runtime data.

## 3107 Validation Gate

Before any production decision:

- run the migration on a throwaway or authorized staging DB
- run repository tests
- run runtime isolation checks
- run security release checks
- run log redaction checks
- verify health on `3107`
- verify watchdog equivalent is healthy and owned
- verify `newApiCalled=false`
- verify no generation provider was called
- verify `data-staging/uploads-staging` checksums did not change unexpectedly

## 3106 Release Boundary

Stage 9C does not authorize `3106` release. `3106` publish remains forbidden
until a later user instruction separately authorizes:

- production candidate commit
- CI success
- production backup
- rollback plan
- maintenance window if needed
- post-release observation

## Forbidden In Stage 9C Without New Authorization

- payment or quota implementation
- user/auth/session migration
- provider secret DB storage
- real generation smoke tests
- live provider `/models`
- NewAPI calls
- production DB write
- production migration
- `3106` publish or restart
- network/firewall/PostgreSQL/NewAPI listener changes

## Commands Requiring Separate Authorization

- any migration apply command against staging
- any migration apply command against production
- any backup or restore command against production
- any JSON-to-DB data migration
- any command that writes `data`, `uploads`, `data-staging`, or
  `uploads-staging`
- any real generation or provider probe
- any `3106` deploy, restart, stop, or rollback

## Entry Criteria Checklist

Stage 9C may be planned only when:

- CI is green.
- `check:database-gate` passes.
- Stage 9B PR is reviewed.
- the target database is named.
- the first migration file is additive only.
- backup and restore steps are explicit.
- `3106` remains untouched.
- the user explicitly authorizes the Stage 9C start.
