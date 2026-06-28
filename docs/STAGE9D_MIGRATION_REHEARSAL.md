# Stage 9D Migration Rehearsal

Stage 9D is a rehearsal stage. It does not authorize a real migration on production, staging, 3106, or 3107.

## Command

```powershell
npm run db:migration:rehearsal
```

By default the command is static-only. It scans migration files, orders them, flags destructive tokens, and reports whether manual authorization is still required.

If a throwaway PostgreSQL database is explicitly configured, the command can rehearse migration application against that isolated target only:

```powershell
$env:STAGE9D_REHEARSAL_DATABASE_URL="postgresql://[masked-test-credentials]@127.0.0.1:5432/rollback_drill"
$env:STAGE9D_REHEARSAL_EXPECTED_NAME="rollback_drill"
npm run db:migration:rehearsal
```

The database name must clearly be test-only. The script refuses names that look like production, staging, 3106, 3107, or NewAPI.

## What The Rehearsal Confirms

- migration file count and order
- static detection of `DROP`, `TRUNCATE`, and destructive `ALTER`
- repeatability on a throwaway test database when explicitly configured
- production execution forbidden
- staging execution requires separate user authorization
- no real provider, generation endpoint, or NewAPI call
- no production or staging database write

## Hard Boundary

Stage 9D rehearsal must not:

- use `APP_DATABASE_URL`
- connect to a production database
- connect to a staging database for real writes
- publish 3106
- restart 3106
- switch runtime feature flags
- call generation providers or NewAPI
- incur cost

## Promotion Rule

Stage 9D rehearsal passing means the migration plan is reviewable. It does not mean real migration is allowed. Stage 9E still requires fresh preflight, backup, rollback authorization, and separate user approval.
