# Database Backup And Restore Runbook

This runbook documents the backup requirements before any future database release. Stage 9C-A does not publish 3106, does not run production migration, and does not write production or staging databases.

## PostgreSQL Backup

Before a future authorized production migration:

1. Confirm the exact production commit, PID, service port, and runtime identity.
2. Confirm `APP_DATABASE_URL` is configured but never print its value.
3. Run a PostgreSQL custom-format backup with `pg_dump --format=custom`.
4. Store the dump outside Git and outside `.runtime` release artifacts.
5. Record only masked metadata:
   - database name
   - host category
   - port
   - username hash
   - backup file checksum
   - created timestamp

Do not commit database dumps, backup folders, restore artifacts, or raw connection strings.

## Restore Verification

Every production backup must be verified before migration:

```powershell
pg_restore --list <backup.dump>
```

The restore list confirms that the dump is readable. It does not modify the database.

For full drills, restore into a throwaway database first and verify:

- expected tables exist
- row counts are plausible
- schema migrations are present
- application identity checks pass

## Data And Uploads Snapshot

Database changes can reference file objects. Before any future production cutover:

1. Snapshot `data`.
2. Snapshot `uploads`.
3. Record count, size, and sha256 manifest.
4. Store snapshots outside Git.
5. Verify snapshots are readable.

Do not commit `data`, `uploads`, `data-staging`, `uploads-staging`, backups, dumps, or manifests that contain real user data.

## Restore Order

For a future release rollback:

1. Stop only the service authorized for rollback.
2. Restore PostgreSQL from the verified dump.
3. Restore `data` and `uploads` snapshots that match the database backup.
4. Restart only the authorized service.
5. Verify health, identity, and data checksums.

3106 must never be stopped, restarted, or published unless the user explicitly authorizes a production release or rollback.

## Stop Conditions

Stop immediately if:

- the database name does not match the expected identity
- `pg_restore --list` fails
- backup checksum is missing
- data/uploads snapshot checksum changes unexpectedly
- a secret appears in logs
- production or staging database would be written without explicit authorization
- NewAPI or generation endpoints would be called

## Stage 9C-A Boundary

Stage 9C-A only adds schema, repository foundation, tests, docs, and temporary test database validation.

It does not:

- run production migration
- run staging migration by default
- migrate JSON library data
- migrate uploads
- publish 3106
- restart 3106
- call NewAPI
- call generation providers
- implement payment or real orders
