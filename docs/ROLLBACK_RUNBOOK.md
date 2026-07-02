# Rollback Runbook

This is the current rollback entry for the Ubuntu 3106 production shape. Older
Windows-local rollback paths were archived under
[archive/windows-local-environment/ROLLBACK_RUNBOOK.md](archive/windows-local-environment/ROLLBACK_RUNBOOK.md).

## Rollback Principles

- Prefer `git revert` for a bad independent module commit before it reaches a
  production release.
- Code rollback and data restore are separate decisions.
- A Git rollback must not overwrite user data.
- Restore operations require explicit production approval and stopped writes.
- 3107 is local-only and must not be treated as a server rollback target.

## Code Rollback

Use code-only rollback when the incident is limited to application code and the
database, `data`, and uploads are still valid. The rollback target must be an
explicit reviewed commit or release artifact. Run release checks before
switching service traffic.

## Data Restore

Use data restore only when data, PostgreSQL rows, or required metadata are part
of the incident.

Restore flow:

1. Stop new writes and generation submissions.
2. Verify the backup manifest.
3. Verify checksums and `pg_restore --list` when PostgreSQL is present.
4. Confirm the target database identity.
5. Restore PostgreSQL from the verified dump.
6. Restore required `data` metadata files.
7. Repair permissions.
8. Start 3106.
9. Run provider-safe health checks and functional acceptance.

Default daily backups intentionally exclude 24-hour generated media. See
[SERVER_BACKUP_AND_RESTORE.md](SERVER_BACKUP_AND_RESTORE.md) for backup and
restore commands.

## Stop Conditions

Stop rollback if:

- the backup manifest fails verification;
- checksums fail;
- `pg_restore --list` fails;
- restore target identity is unclear;
- writes have not been stopped;
- a secret-shaped value appears in output;
- production approval is missing;
- the proposed smoke test would call generation, upscale, providers, New API
  generation, billing writes, migrations, or cleanup apply.
