# Server Backup And Restore

This document defines the backup policy for a single 60GB Ubuntu production
server that runs only the 3106 service. It complements the deploy rollback
material in `docs/ROLLBACK_RUNBOOK.md`; it does not replace that rollback path.

## Scope

Must back up:

- PostgreSQL business data with `pg_dump --format=custom`.
- Users, sessions, quota, orders, payments, billing records, and task billing
  records through the PostgreSQL dump when those backends are enabled.
- Necessary `data` metadata such as `library.json`, `jobs.json`, provider
  config, auth/billing/quota JSON stores still active in local fallback mode,
  and New API mapping JSON.
- Provider configuration files with restricted backup permissions.
- Database migration SQL files and migration state contained in PostgreSQL,
  including `schema_migrations`.
- Application commit, branch, package version, Node.js version, and restore
  manifest.

Default exclusions:

- Generated images and videos that expire after 24 hours.
- Temporary uploads.
- Cache directories.
- Temporary provider files that can be fetched or regenerated.
- Ordinary runtime logs.

Deployment rollback backups may still include `uploads` when they are created
for an immediate release rollback window. Daily server backups do not treat
24-hour media as long-term backup material.

## Commands

Dry-run backup plan:

```powershell
npm run ops:backup:dry-run
```

Create a short-term server backup:

```powershell
npm run ops:backup:apply
```

Preview old local backup cleanup:

```powershell
npm run ops:backup:prune:dry-run
```

Apply old local backup cleanup:

```powershell
npm run ops:backup:prune:apply
```

Verify a backup before any restore:

```powershell
npm run ops:restore:verify -- --backup <server-backup-dir>
```

The restore script defaults to verification only. Production restore apply is
blocked unless the operator explicitly confirms restore intent, confirms writes
are stopped, and passes the production restore gate.

## Backup Safety

The backup script:

- defaults to dry-run.
- writes to a temporary directory first.
- writes the manifest only after artifacts are present.
- verifies checksums before atomically renaming the backup directory.
- uses the existing service operation lock to block concurrent backups,
  deploys, and rollbacks.
- uses `PGPASSWORD` for PostgreSQL subprocesses so the database password is not
  passed as a command argument.
- stores only masked database metadata in the manifest.
- refuses production backup without `APP_DATABASE_URL` unless an explicit
  test-only override is passed.
- refuses backup roots inside the release root, data, uploads, or runtime
  directories.
- keeps manifests free of passwords, tokens, keys, cookies, and full database
  URLs.

The manifest includes:

- backup time
- service name and port
- source commit and branch
- package name and version
- Node.js version
- database backup metadata
- data metadata file count, size, and checksums
- migration file count, size, and checksums
- artifact count and total bytes
- explicit `uploadsBackedUp: false`

## Retention

The 60GB system disk is only a short-term backup location. Local backups should
be copied to external storage, a cloud disk snapshot, or another machine.

Local retention defaults to a small count suitable for a single server:

```text
SERVER_BACKUP_RETENTION_COUNT=5
```

Allowed local retention is 3 to 7 backups. Invalid values fall back to the safe
default. Pruning supports dry-run and deletes only recognized backup directories
inside the configured backup root.

## Restore Flow

Production restore is a manual incident operation, not part of automated module
work.

1. Stop new writes and generation submissions.
2. Confirm the selected backup directory is the intended one.
3. Run restore verification and inspect the manifest.
4. Confirm `pg_restore --list` passed when PostgreSQL is present.
5. Stop the 3106 service only after restore approval.
6. Restore PostgreSQL from the verified dump.
7. Restore required `data` metadata files.
8. Repair ownership and permissions.
9. Start 3106.
10. Run safe health checks and functional acceptance.
11. Confirm users, quota, orders, billing records, library metadata, provider
    configuration, and migration state are consistent.

Do not use `git checkout`, `git revert`, or code rollback as a data restore
mechanism. Code rollback and data restore are separate decisions.

## Stop Conditions

Stop immediately if:

- manifest verification fails.
- checksum verification fails.
- `pg_restore --list` fails.
- the backup belongs to a different service.
- a secret-shaped value appears in output or manifest.
- backup root is inside release, data, uploads, or runtime directories.
- restore target database identity does not match the manifest.
- writes have not been stopped before restore apply.
- the operator has not explicitly approved production restore.
