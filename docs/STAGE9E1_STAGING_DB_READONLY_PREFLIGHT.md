# Stage 9E-1 Staging DB Read-Only Preflight

Stage 9E-1 is a read-only staging database identity preflight. It does not authorize migration, database write, import, feature flag cutover, 3106 action, NewAPI call, provider call, generation, or cost.

## Hard Boundary

This preflight must stay true to all of the following:

- staging DB read-only connection only
- no production DB connection
- no staging DB write
- no production DB write
- no staging migration
- no production migration
- no real `data/uploads` read, import, move, delete, or modification
- no feature flag change
- no 3106 publish, restart, stop, rollback, or upgrade
- no NewAPI call
- no real provider call
- no generation cost

## Environment Variables Used

The preflight uses these environment variable names only. Do not print their secret values in logs or Git.

- `APP_DATABASE_URL`: establish the staging DB connection
- `APP_DATABASE_EXPECTED_NAME`: verify `current_database()` matches the approved target
- `APP_DATABASE_CONNECT_TIMEOUT_MS`: bound connection timeout
- `APP_DATABASE_QUERY_TIMEOUT_MS`: bound read-only query timeout
- `APP_DATABASE_MAX_CONNECTIONS`: keep the connection pool minimal

## Read-Only Query Set

The preflight is limited to:

1. `BEGIN READ ONLY`
2. identity summary:
   - `current_database()`
   - `current_user`
   - `current_schema()`
   - `version()`
   - `inet_server_addr()`
   - `inet_server_port()`
3. role attribute check:
   - `pg_roles`
4. privilege check:
   - `has_database_privilege`
   - `has_schema_privilege`
   - `has_table_privilege`
5. existence check:
   - `to_regclass('public.<table>')`
6. `ROLLBACK`

The preflight must not execute `CREATE`, `ALTER`, `DROP`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `GRANT`, `REVOKE`, migration commands, or any state-changing SQL.

## Identity Summary

Non-sensitive staging target summary:

- host summary: `loopback:127.0.0.1`
- port: `5432`
- database name: `aohuang_app`
- current user / role: `staging_user`
- current schema: `public`
- PostgreSQL version: `PostgreSQL 16.14`
- expected database name matched: `true`

## Production Risk Check

Observed signals:

- host is loopback-only
- database name does not look production-like
- current user name looks staging-specific
- `current_database()` matched `APP_DATABASE_EXPECTED_NAME`

Current conclusion:

- direct production pointer risk: not detected
- identity ambiguity: not detected

Note:

- the database name is generic and not staging-specific by itself
- the current evidence still points to the approved staging target because the host is loopback-only, the role name is staging-specific, and the expected-name check matched

## Role Risk Check

The current role exceeded Stage 9E-1 read-only expectations.

Observed role flags:

- `rolsuper=true`
- `rolcreatedb=true`
- `rolcreaterole=true`
- `rolreplication=true`
- `rolbypassrls=true`

Observed privilege summary:

- database create privilege: `true`
- database temp privilege: `true`
- schema create privilege: `true`
- schema usage privilege: `true`

Risk assessment:

- risk level: `high`
- blocker: the current role is admin and DDL-capable, so it is not a least-privilege read-only staging role

## Migration Table And MVP Table Probe

The preflight stopped as soon as the high-risk role finding was confirmed.

Because of that stop condition:

- `schema_migrations` status was not probed
- migration version status was not enumerated

The existence probe that ran before the role blocker was confirmed reported:

- `generation_jobs`: `false`
- `assets`: `false`
- `library_items`: `false`
- `provider_model_snapshots`: `false`
- `api_call_logs`: `false`
- `error_events`: `false`
- `audit_logs`: `false`
- `quota_accounts`: `false`
- `quota_ledger`: `false`

This result is not enough to authorize any next stage because the privilege blocker was hit first.

## Stop Condition Triggered

Stage 9E-1 stopped with:

- `Current role has write-capable or admin privileges that exceed Stage 9E-1 read-only expectations; stopping before migration-table probing.`

This stop condition is expected behavior under Stage 9E-1 rules.

## Rerun Result

A later separately authorized rerun used `stage9e_readonly_preflight` with a least-privilege staging read-only role.

Rerun summary:

- read-only transaction completed
- host summary: `loopback:127.0.0.1`
- port: `5432`
- database name: `aohuang_app`
- current user / role: `stage9e_readonly_preflight`
- current schema: `public`
- PostgreSQL version: `PostgreSQL 16.14`
- expected database name matched: `true`
- direct production pointer risk: not detected
- role exceeded-read-only blocker: not detected
- role flags:
  - `rolsuper=false`
  - `rolcreatedb=false`
  - `rolcreaterole=false`
  - `rolreplication=false`
  - `rolbypassrls=false`
- database privileges:
  - `CONNECT=true`
  - `CREATE=false`
  - `TEMP=false`
- schema privileges:
  - `USAGE=true`
  - `CREATE=false`
- `default_transaction_read_only=on`
- current session `transaction_read_only=on`
- `schema_migrations` exists and is readable
- applied migrations: `6`
- latest applied migration: `006_task_billing_dispatch_states`
- Stage 9C MVP tables not present yet:
  - `generation_jobs`
  - `assets`
  - `library_items`
  - `provider_model_snapshots`
  - `api_call_logs`
  - `error_events`
  - `audit_logs`
  - `quota_accounts`
  - `quota_ledger`
- no migration, write, import, feature flag, 3106 action, NewAPI call, provider call, generation, or cost was authorized

## Original Blocker Remediation

Do not enter Stage 9E-2.

The initial run required this remediation before the successful rerun above.

Before Stage 9E-1 is retried:

1. provide a separately approved least-privilege staging read-only role
2. confirm the new role does not have superuser, create-db, create-role, replication, bypass-RLS, or schema create privileges
3. rerun the same read-only identity preflight under separate user authorization

## Current Conclusion

Stage 9E-1 has now passed after the successful `stage9e_readonly_preflight` rerun under a least-privilege staging read-only role.

This confirms staging database identity for Stage 9E-1 only. It does not authorize migration, database write, import, feature flag cutover, 3106 action, NewAPI call, provider call, generation, or cost.

## Stage 9E-2 Plan-Only Summary

Stage 9E-2 remains plan-only unless separately authorized. The next review should cover backup artifact expectations, checksum and manifest evidence, disposable restore-target identity, and restore verification queries.

Plan-only placeholders for the next authorization review:

- backup scope placeholder: `<STAGING_DB>`, `<BACKUP_ARTIFACT>`, `<BACKUP_MANIFEST>`, `<BACKUP_CHECKSUM>`
- restore target placeholder: `<DISPOSABLE_RESTORE_TARGET_DB>`, `<RESTORE_HOST_LABEL>`, `<RESTORE_SCHEMA>`
- placeholder commands only:
  - `pg_dump --dbname=<APPROVED_STAGING_DSN> --format=custom --file=<BACKUP_ARTIFACT>`
  - `pg_restore --list <BACKUP_ARTIFACT>`
  - `psql <APPROVED_RESTORE_DSN> -c "select current_database(), current_user, current_schema();"`
- required pre-execution checks:
  - approved staging-only target identity
  - approved disposable restore target identity
  - backup artifact path, manifest, and checksum
  - explicit stop/go owner and rollback owner
- stop conditions:
  - target identity mismatch
  - production signal detected
  - backup artifact or checksum mismatch
  - restore target not confirmed disposable

This PR does not implement or authorize Stage 9E-2 execution.
