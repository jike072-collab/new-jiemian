# Database Migration Plan

Stage 9A does not run migrations. This plan describes the future process for
safe schema and data migration work.

## Tool Recommendation

Continue using the existing `pg` plus raw SQL migration toolchain:

- current migrations live in `db/migrations`
- `scripts/database/migrate.mjs` records checksums in `schema_migrations`
- `APP_DATABASE_EXPECTED_NAME` protects against wrong-database execution
- SQL files are easy to review in PRs
- no ORM-generated code enters client bundles

Drizzle can be reconsidered only after repositories become broad enough that
typed query construction is worth the added toolchain. Prisma is not recommended
for the next stage because generated clients and engine lifecycle add process
weight that is not needed for current controlled migrations.

## Schema Change Flow

1. Design document first.
2. Create a new migration file with the next numbered prefix.
3. Include only forward changes; no destructive cleanup in the first release.
4. Add or update repository code behind feature flags or persistence modes.
5. Add migration tests and schema assertions.
6. Run CI on Linux and Windows.
7. Deploy to 3107 or an isolated database first.
8. Back up production database, `data`, and `uploads`.
9. Run migration only after explicit release authorization.
10. Verify health, watchdog, application checks, and targeted row counts.

## Local Development Database

Local development should use a disposable PostgreSQL database with:

- non-production credentials
- explicit `APP_DATABASE_EXPECTED_NAME`
- small seeded fixtures only
- no copied production secrets
- reset scripts that refuse production-like database names

## Staging Database Strategy

3107 must not read or write the 3106 production database.

Staging should use:

- separate database name
- separate credentials
- separate `DATA_DIR=data-staging`
- separate `UPLOADS_DIR=uploads-staging`
- explicit expected database name
- preflight checks that fail if production and staging identities match

## Production Database Strategy

3106 production database changes require:

- user authorization for the release
- current main commit and CI success
- backup before migration
- rollback instructions
- maintenance window for any locking risk
- post-migration validation

Production migration commands must fail closed when:

- `APP_DATABASE_URL` is missing
- `APP_DATABASE_EXPECTED_NAME` is missing
- current database name does not match expected name
- release preflight fails
- backup material cannot be verified

## Avoiding Staging/Production Cross-Writes

Required guardrails:

- compare database identity, not just connection string text
- compare service name, root, port, data dir, uploads dir
- fail if 3107 uses default production `data/` or `uploads/`
- fail if staging and production database names match
- fail if migration target is not explicitly named
- never infer safety from a masked URL

## Migration Backup Requirements

Before production migration:

- `pg_dump` custom-format backup
- `pg_restore --list` verification
- `data` snapshot
- `uploads` snapshot
- backup manifest
- checksum file
- rollback script
- fresh rollback authorization

Do not commit dumps, manifests, backup files, runtime files, or environment
files to Git.

## Post-Migration Validation

Validation should include:

- migration status and checksum verification
- expected table/index/constraint list
- application health endpoint
- watchdog
- auth session smoke through automated route checks
- library endpoint read
- provider admin protection
- targeted count-only checks
- log redaction scan
- data/uploads snapshots unchanged unless the migration explicitly includes a
  data move

## Failure And Rollback Strategy

If schema migration fails before commit:

- stop immediately
- keep logs
- do not retry blindly
- inspect safe error category only

If migration commits but app validation fails:

- keep production stopped or guarded if user impact is severe
- restore DB from the matching backup only with fresh authorization
- restore `data/uploads` from the same backup set if any file move was involved
- verify checksums before reopening service

If file and DB state diverge:

- do not hard-delete anything during incident handling
- run reconciliation in read-only mode first
- restore from matched backup or apply a targeted repair plan after approval

## Schema Drift Checks

Use schema drift checks before any migration-bearing branch is considered
releaseable.

CI should verify:

- all migration files have stable checksums
- `schema_migrations` status matches files on a test database
- required tables, constraints, and indexes exist
- database code is server-only
- database URL strings do not enter client bundles

## Windows/Linux Differences

Keep migration and backup scripts portable:

- use Node scripts for orchestration
- avoid shell-specific parsing where possible
- quote paths with spaces and non-ASCII characters
- test path handling on Windows and Linux
- use `pg_dump`/`pg_restore` discovery with clear failure messages

## Secrets Handling

- never print database URLs
- never print usernames if policy treats them as sensitive
- never print passwords
- print only `configured`, `missing`, `masked`, or `schema_only`
- redact errors before they reach logs or API responses

## When Schema Changes Are Allowed

Allowed only in a separately authorized implementation stage:

- new tables for library/assets/jobs
- additive columns with safe defaults
- indexes created with locking risk considered
- constraints after data backfill has been verified

Forbidden in audit or observation stages:

- DDL
- migration execution
- production data backfill
- destructive cleanup
- schema rewrites mixed with unrelated UI work

## Changes Requiring Separate Release

- any migration touching production tables
- any migration moving library/assets from JSON to DB
- any payment or quota ledger migration
- any provider secret storage change
- any hard-delete or purge mechanism

## Documentation-First Changes

Safe to document before implementation:

- future table proposals
- migration runbooks
- backup strategy
- data flow diagrams
- security redaction requirements
- staged rollout checklists
