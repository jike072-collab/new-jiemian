# Stage 9D Release Gates

Stage 9D is not a production release stage. It exists to prove rehearsal, dry-run, consistency, and rollback surfaces before Stage 9E is considered.

## Stage 9D Must Stay True

- rehearsal only
- dry-run only
- no real migration
- no real import
- no 3106 publish
- no 3106 restart
- no production database write
- no staging database write unless a throwaway isolated test database is explicitly named
- no NewAPI call
- no real provider call
- no generation cost

## Stage 9E Entry Gates

Do not enter Stage 9E unless all of the following are complete:

1. Stage 9D checks pass locally and in CI.
2. Backups are documented with backup manifest and checksum files.
3. `pg_restore --list` verification is documented.
4. rollback authorization flow is documented.
5. feature flags remain default-off and safe.
6. 3106 remains untouched during Stage 9D.
7. separate user authorization is granted for any real migration or real import.

## Explicit Blockers

Stage 9E is blocked if:

- CI is failing
- rollback documentation is incomplete
- destructive migration findings are unexplained
- 3106 or 3107 data summaries drift unexpectedly
- NewAPI or provider calls appear in a no-call stage
- cost is incurred in a rehearsal-only stage
