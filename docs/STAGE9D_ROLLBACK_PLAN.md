# Stage 9D Rollback Plan

Stage 9D prepares rollback readiness only. It does not auto-execute rollback and it does not authorize a production release.

## Backup Requirements

Before any future real migration or import:

1. Create a PostgreSQL backup with `pg_dump --format=custom`.
2. Verify the dump with `pg_restore --list`.
3. Snapshot `data`.
4. Snapshot `uploads`.
5. Generate a backup manifest.
6. Generate checksum files for database dump, data snapshot, and uploads snapshot.
7. Store all backups outside Git and outside `.runtime`.

## Rollback Scope

The rollback plan must cover:

- database restore
- data restore
- uploads restore
- app commit rollback
- feature flag rollback
- health verification after rollback
- library readability verification after rollback
- confirmation that NewAPI was not called
- confirmation that no generation cost was incurred

## Stop Conditions

stop immediately if any of the following conditions are true:

- backup manifest is missing
- checksum verification fails
- `pg_restore --list` fails
- database identity does not match the explicit expected name
- 3106 would be touched without separate user authorization
- real migration or real import would start unexpectedly
- a secret appears in logs
- NewAPI or a real provider would be called

## Authorization Boundary

The following require separate user authorization:

- any real production migration
- any real staging migration
- any real import into database tables
- any 3106 publish, restart, stop, or rollback
- any feature flag cutover from JSON to database

The following must be marked `Do not auto-execute`:

- production rollback
- staging rollback against shared data
- production data restore
- production uploads restore
- production feature flag cutover
