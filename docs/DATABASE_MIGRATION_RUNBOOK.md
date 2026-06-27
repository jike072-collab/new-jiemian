# Database Migration Runbook

This runbook covers Stage 9C-A database MVP migration checks. It is not a production deployment authorization.

## Allowed Checks

Static schema check:

```powershell
npm run db:schema:check
```

Migration safety check:

```powershell
npm run db:migrate:check
```

Without `STAGE9C_TEST_DATABASE_URL` and `STAGE9C_TEST_DATABASE_EXPECTED_NAME`, `db:migrate:check` runs static-only validation and does not connect to any database.

Repository test:

```powershell
npm run test:database-mvp
```

This runs repository tests with mock query functions. If a safe temporary test database is explicitly configured, it also runs `db:migrate:check`.

## Temporary Test Database

To run migration checks against a throwaway PostgreSQL database:

```powershell
$env:STAGE9C_TEST_DATABASE_URL="postgresql://[masked-test-credentials]@127.0.0.1:5432/stage9c_test"
$env:STAGE9C_TEST_DATABASE_EXPECTED_NAME="stage9c_test"
npm run db:migrate:check
```

The database name must clearly be test-only, such as `stage9c_test`, `tmp_stage9c`, `ci_stage9c`, or `rollback_drill`.

The script refuses names that look like production, staging, 3106, 3107, or NewAPI databases.

## Avoiding Production DB

Do not use APP_DATABASE_URL for Stage 9C-A migration checks.

The Stage 9C-A wrapper only reads:

- `STAGE9C_TEST_DATABASE_URL`
- `STAGE9C_TEST_DATABASE_EXPECTED_NAME`

It passes those values to the existing migration runner as masked test-only inputs.

Never paste or print the full database connection string in reports, logs, PR descriptions, or comments.

## Forbidden Production Commands

These commands are forbidden on production without a separate release gate:

```powershell
npm run migrate
npm run migrate:status
npm run db:health
node scripts/database/migrate.mjs up
node scripts/database/migrate.mjs status
node scripts/database/migrate.mjs health
```

They are also forbidden when `APP_DATABASE_URL` points at a production or staging database.

## Rollback

Stage 9C-A does not include an automatic production rollback because it must not be applied to production in this stage.

For a temporary test database:

1. Drop the throwaway database.
2. Recreate it from a clean template if needed.
3. Re-run `npm run db:migrate:check`.

For any future production migration, rollback must be separately authorized and must include:

- production database backup
- `pg_restore --list` verification
- data/uploads snapshot
- tested restore path
- stop condition if identity checks fail

## Repeatability

The migration runner records checksums in `schema_migrations`.

Re-running against the same temporary test database should either:

- report all migrations as already applied, or
- fail if a previously applied migration checksum changed.

Checksum mismatch is a blocker and must not be bypassed.
