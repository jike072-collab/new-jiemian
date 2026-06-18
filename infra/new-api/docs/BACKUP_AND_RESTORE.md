# Backup And Restore

## Backup Scope

Backup artifacts must include:

- database backup or database snapshot
- configuration backup
- non-database runtime files needed to inspect or restore the isolated deployment
- file checksum manifest
- retention metadata
- directory permissions note

## Backup Rules

- never store plain-text secrets in the repository
- redact environment values before archival output
- fail with a non-zero exit code when prerequisites are missing
- write backups to a local backup directory, not to version control
- record retention-expired backup directories without deleting them automatically
- database state is backed up with `pg_dump`; PostgreSQL data directories are not hot-copied from the running container

## Restore Rules

- restoration requires an explicit backup directory argument
- restoration requires `--confirm RESTORE_NEW_API_TEST` unless run as `--dry-run`
- restore must auto-create a fresh backup before destructive state changes
- restore must reject incomplete backup directories
- restore must support dry-run mode
- restoration is only valid in an isolated environment with test data

## Required Real Restore Test

Run this on a Docker-enabled isolated host:

1. start the New API stack
2. initialize a test administrator
3. create a small test record through New API
4. run `scripts/backup`
5. change or remove the test record
6. run `scripts/restore --backup <backup-dir> --confirm RESTORE_NEW_API_TEST`
7. start the stack again
8. confirm login works
9. confirm the test record exists
10. run `scripts/restore --backup <bad-backup-dir> --confirm RESTORE_NEW_API_TEST` and confirm it is rejected
11. confirm the pre-restore backup can be used as a rollback source

Do not mark B06 operationally complete until this test is run and recorded.
