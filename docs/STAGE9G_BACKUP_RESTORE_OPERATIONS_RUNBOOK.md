# Stage 9G-3 Backup Restore Operations Runbook

Stage 9G-3 converts Stage 9E backup and disposable restore lessons into an operations runbook.

This document is planning and runbook material only. It does not execute a backup, execute a restore, create or drop a database, connect to production DB, write any database, operate 3106, read real uploads, move uploads, delete uploads, call NewAPI, call a provider, trigger generation, or incur cost.

## Hard Boundary

The following remain forbidden unless a later prompt explicitly authorizes a specific action:

- no real backup execution
- no real restore execution
- no database creation, drop, overwrite, or cleanup
- no production DB connection
- no production migration
- no production DB write
- no 3106 operation
- no real uploads read
- no uploads import, move, delete, or modification
- no business-data write
- no feature-flag change
- no rollback execution
- no provider or NewAPI call
- no generation trigger
- no cost

Every command in this document is a placeholder template. Do not execute it from this document.

## Purpose

This runbook defines the future operator process for:

- staging backup identity guard
- staging backup artifact creation
- backup checksum and manifest capture
- disposable restore verification
- production and 3106 no-go boundaries
- future uploads backup planning
- recovery decision trees
- evidence capture

It intentionally separates documented operations from authorization.

## 1. Staging Backup Runbook

### Required Authorization

Before a real staging backup can happen, the authorization must name:

- approved staging DB identity
- backup operator
- backup scope
- backup output location
- artifact retention window
- stop/go decision owner
- rollback owner
- maximum allowed runtime

### Identity Guard

Before backup execution, verify and record only non-sensitive values:

- host label = `<STAGING_HOST_LABEL>`
- port = `<STAGING_PORT>`
- database name = `<STAGING_DB>`
- schema = `<STAGING_SCHEMA>`
- role = `<BACKUP_ROLE>`
- expected environment = `<STAGING_ENVIRONMENT_LABEL>`
- target is not production
- target is not 3106
- target matches the previously approved staging identity

### Production Signal Check

Stop immediately if any of the following appears:

- database name, host label, role, or service label looks production-like
- host or database identity is ambiguous
- connection method contains a production label
- operator cannot prove the target is staging
- target is related to 3106

### Backup Scope

A future backup authorization must choose exactly one:

- schema-only backup
- data-only backup
- full logical dump

Default recommendation:

- use a PostgreSQL custom-format logical dump for restore verification
- store outside Git
- store outside `.runtime` release artifacts
- never commit dump files, manifests containing sensitive data, or full DSNs

### Placeholder `pg_dump` Template

Do not execute without separate authorization.

```powershell
pg_dump `
  --format=custom `
  --verbose `
  --file "<BACKUP_ARTIFACT>" `
  "<APPROVED_STAGING_DSN>"
```

### Artifact Path Rules

Backup artifacts must:

- live outside Git
- live outside `.runtime/releases`
- live outside `.runtime/release-worktrees`
- avoid production artifact paths
- avoid shared ad hoc folders
- use timestamped names
- include service and environment labels
- not include secrets in the filename

Placeholder path:

```text
<BACKUP_ROOT>/<SERVICE>-<ENVIRONMENT>-<YYYYMMDD-HHMMSS>/<BACKUP_ARTIFACT>
```

### Checksum

Do not execute without separate authorization.

```powershell
Get-FileHash -Algorithm SHA256 "<BACKUP_ARTIFACT>" |
  Out-File "<BACKUP_CHECKSUM>"
```

Record only:

- algorithm
- checksum value
- artifact basename
- file size
- created timestamp

### Manifest

The backup manifest should include:

- service name
- environment label
- source commit
- source runtime root
- backup operator
- decision owner
- staging DB identity summary
- backup scope
- artifact basename
- artifact size
- artifact checksum
- `pg_dump` version
- `pg_restore` version
- created timestamp
- redaction confirmation

The manifest must not include:

- password
- full DSN
- token
- cookie
- API key
- raw secret

### Redaction

All output must be redacted before it is copied into Git or a PR:

- no `APP_DATABASE_URL`
- no `PGPASSWORD`
- no raw connection string
- no authorization header
- no secret-bearing shell output

## 2. Disposable Restore Runbook

### Required Authorization

Before a disposable restore can happen, authorization must name:

- approved backup artifact
- approved restore operator
- approved disposable restore target identity
- cleanup owner
- rollback owner
- stop/go decision owner
- maximum allowed runtime

### Disposable Target Naming

Disposable restore target names must be visibly disposable and stage-scoped.

Recommended pattern:

```text
<APP>_<STAGING_LABEL>_restore_verify_<YYYYMMDD_HHMMSS>
```

Forbidden names:

- production DB names
- current staging DB name
- 3106-related names
- generic shared names such as `app`, `main`, `prod`, `production`, `staging`

### Target Identity Guard

Record only non-sensitive values:

- host label = `<RESTORE_HOST_LABEL>`
- port = `<RESTORE_PORT>`
- database name = `<DISPOSABLE_RESTORE_DB>`
- schema = `<RESTORE_SCHEMA>`
- restore role = `<RESTORE_ROLE>`
- target is disposable
- target is isolated from 3107 live traffic
- target is not production
- target is not 3106

### Never Restore Over Main DB

The restore target must never be:

- the live staging DB
- production DB
- 3106 DB
- any long-lived shared DB
- any DB referenced by live 3107 app traffic

### `pg_restore --list`

Always list the backup before restore.

Do not execute without separate authorization.

```powershell
pg_restore --list "<BACKUP_ARTIFACT>" |
  Out-File "<PG_RESTORE_LIST_OUTPUT>"
```

Stop if:

- the list command fails
- the artifact checksum does not match
- expected schema objects are absent
- production-like object names appear unexpectedly

### Placeholder Restore Template

Do not execute without separate authorization.

```powershell
pg_restore `
  --verbose `
  --clean `
  --if-exists `
  --no-owner `
  --no-privileges `
  --dbname "<APPROVED_DISPOSABLE_RESTORE_DSN>" `
  "<BACKUP_ARTIFACT>"
```

### Restore Verification

Do not execute without separate authorization.

```powershell
psql "<APPROVED_DISPOSABLE_RESTORE_DSN>" `
  -c "SELECT current_database(), current_user, current_schema();"
```

```powershell
psql "<APPROVED_DISPOSABLE_RESTORE_DSN>" `
  -c "SELECT COUNT(*) AS migration_rows FROM <SCHEMA>.schema_migrations;"
```

Verification should confirm:

- target DB identity is disposable
- `schema_migrations` exists
- expected MVP tables exist
- row counts are plausible for the expected source
- role privileges are limited to the restore target
- no production signal exists
- evidence contains no secrets

### Cleanup Authorization

Cleanup of a disposable restore DB is still a destructive operation.

Do not clean, drop, or modify the restore target unless a later prompt explicitly authorizes cleanup and names:

- target DB name
- cleanup operator
- cleanup owner
- evidence that target is disposable
- latest verification evidence

## 3. Production And 3106 Forbidden Boundary

Default answer:

- production: not allowed
- 3106: not allowed

Production or 3106 backup/restore work requires:

- separate user authorization
- explicit production target identity
- explicit 3106 impact statement
- extra confirmation that the target is not staging
- named rollback owner
- named decision owner
- exact command scope
- current backup and restore evidence

Never infer production permission from staging permission.

Never infer 3106 permission from 3107 permission.

## 4. Uploads Backup Future Plan

Current plan:

- no real uploads read in this stage
- no uploads import
- no uploads move
- no uploads delete
- no uploads modification

Future uploads backup planning should include:

- read-only inventory authorization
- file count
- total size
- checksum manifest
- relative-path-only manifest entries
- no file contents in Git
- no delete or move
- stop if path traversal or symlink ambiguity appears
- incremental backup candidates only after inventory is accepted

Future placeholder inventory summary:

```text
uploadsRoot=<UPLOADS_ROOT_LABEL>
fileCount=<COUNT>
totalBytes=<BYTES>
manifest=<CHECKSUM_MANIFEST>
readOnly=true
deleteMoveModify=false
```

## 5. Recovery Decision Tree

### App Config Rollback

Choose this when:

- runtime config changed
- service health regressed
- DB state remains valid
- uploads state remains valid

Requires:

- separate rollback authorization
- current and target commit
- service scope
- health verification plan

### DB Restore

Choose this only when:

- DB state is corrupted or incompatible
- verified backup exists
- disposable restore verification passed
- rollback owner approves
- service impact is understood

Requires:

- explicit DB restore authorization
- exact target identity
- exact backup artifact
- manifest and checksum verification
- stop/go owner present

### Feature Flag Rollback

Choose this only after:

- feature flag change was previously authorized
- rollback flag name is explicit
- expected behavior is documented

Current stage note:

- this document does not authorize feature flag changes or rollbacks

### When To Stop

Stop immediately if:

- target identity is unclear
- production signal appears
- 3106 is implicated
- backup checksum fails
- restore target is not disposable
- command requires a secret to be printed
- evidence cannot prove what changed
- any step would delete user data
- NewAPI/provider/generation/cost would be triggered

## 6. Evidence Checklist

For backup evidence:

- [ ] authorization text
- [ ] operator
- [ ] decision owner
- [ ] rollback owner
- [ ] staging identity summary
- [ ] backup scope
- [ ] artifact basename
- [ ] artifact size
- [ ] SHA-256 checksum
- [ ] manifest path
- [ ] `pg_dump` version
- [ ] `pg_restore` version
- [ ] redaction confirmation

For restore evidence:

- [ ] restore authorization text
- [ ] disposable target identity summary
- [ ] `pg_restore --list` output summary
- [ ] restore command scope
- [ ] `schema_migrations` status
- [ ] MVP tables status
- [ ] row-count summary
- [ ] no production signal
- [ ] no 3106 involvement
- [ ] cleanup authorization status

For safety evidence:

- [ ] no production DB connection unless separately authorized
- [ ] no 3106 operation unless separately authorized
- [ ] no uploads read unless separately authorized
- [ ] no uploads delete/move/modify
- [ ] no provider/NewAPI call
- [ ] no generation
- [ ] no cost

## Existing Repo Support

Current repo assets that support this runbook:

- `scripts/ops/backup-utils.mjs`
- `scripts/ops/database-backup.mjs`
- `scripts/ops/database-restore.mjs`
- `scripts/ops/rollback-service.mjs`
- `scripts/test-full-rollback-drill.mjs`
- `scripts/database/check-stage9d-rollback-readiness.mjs`
- `docs/DATABASE_BACKUP_RESTORE_RUNBOOK.md`
- `docs/DATABASE_SECURITY_AND_BACKUP_PLAN.md`
- `docs/STAGE9E0_DB_IDENTITY_BACKUP_RESTORE_PLAN.md`
- `docs/STAGE9E_BATCH_B_EXECUTION_PLAN.md`
- `docs/STAGE9E_BATCH_C_DUAL_WRITE_CANARY_ROLLBACK_PLAN.md`

## Outcome

Stage 9G-3 provides a formal backup and restore operations runbook.

It does not execute any backup, restore, cleanup, production operation, 3106 operation, uploads read, DB write, migration, provider call, NewAPI call, generation, or cost-incurring action.
