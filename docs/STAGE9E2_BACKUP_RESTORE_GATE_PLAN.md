# Stage 9E-2 Backup Restore Gate Plan

Module 2 is a plan-only gate for a future staging backup and isolated restore verification. It defines the checklist, stop conditions, operator evidence format, and placeholder command templates that must be reviewed before any later execution module is separately authorized.

This module does not execute backup, restore, migration, database writes, uploads import, feature flag changes, NewAPI calls, provider calls, or 3106 operations.

## 1. Goal And Boundary

Stage 9E-2 plan-only scope:

- define backup and restore verification gates
- define evidence artifacts and operator handoff fields
- define placeholder command templates for later operator use
- define go / no-go and stop conditions
- preserve Module 1 read-only preflight evidence as a prerequisite

Stage 9E-2 plan-only exclusions:

- no real backup execution
- no real restore execution
- no staging DB backup or restore connection in this module
- no production DB connection
- no 3106 operation
- no staging or production migration
- no staging DB write
- no production DB write
- no creation, deletion, overwrite, or restore of any real database
- no real `data/uploads` read, import, move, delete, or modification
- no dual-write enablement
- no read path switch
- no feature flag change
- no NewAPI or provider call
- no real generation
- no cost-incurring action

## 2. Current Accepted Prerequisite

Module 1 / Stage 9E-1 read-only preflight rerun is the required prerequisite for any later execution authorization.

Accepted non-sensitive summary from Module 1:

- role used: `stage9e_readonly_preflight`
- database identity matched expected staging DB
- no production signal observed
- `schema_migrations` exists and is readable
- applied migrations observed: 7
- latest observed migration: `007_database_mvp_foundation`
- MVP tables exist and are SELECT-only for the read-only role
- no DB writes
- no migration
- no real uploads read or import
- no Stage 9E-2 execution

## 3. PR #74 State Reconciliation

PR #74 is historical evidence for Stage 9E-1. It was not merged by this module.

Non-sensitive reconciliation fields to record at module start:

- PR number: `74`
- current state: `<PR_74_CURRENT_STATE>`
- mergedAt: `<PR_74_MERGED_AT>`
- mergeCommit: `<PR_74_MERGE_COMMIT>`
- headRefOid: `<PR_74_HEAD_REF_OID>`
- merge executed by this module: `no`
- current `origin/main` contains PR #74 result: `<YES_OR_NO>`
- judgment: `<HISTORICAL_STATE_CHANGE_OR_EXTERNAL_MERGE_OR_UNAUTHORIZED_MODULE_MERGE_OR_UNKNOWN>`
- Module 2 plan-only impact: `<YES_OR_NO_AND_REASON>`

If evidence ever shows this module performed an unauthorized merge, stop immediately and do not continue the module.

## 4. Backup Scope

A later separately authorized backup stage must name and confirm all scope items before execution.

### Database Backup

Required placeholders:

- staging DB name: `<STAGING_DB>`
- staging host label: `<STAGING_HOST>`
- staging port: `<STAGING_PORT>`
- schema: `<SCHEMA>`
- backup role or operator role: `<READONLY_OR_BACKUP_ROLE>`
- backup output directory: `<BACKUP_PATH>`
- backup artifact name: `<BACKUP_ARTIFACT>`
- backup manifest: `<MANIFEST_PATH>`
- backup checksum file: `<BACKUP_CHECKSUM_PATH>`

The backup target must be the same staging database family accepted by Module 1. Any production, 3106, or ambiguous target signal is a stop condition.

### Uploads Backup / Manifest / Checksum Plan

This module does not read real uploads. A later separately authorized module must confirm:

- uploads path summary: `<UPLOADS_PATH>`
- uploads backup target: `<UPLOADS_BACKUP_PATH>`
- uploads manifest file: `<UPLOADS_MANIFEST_PATH>`
- uploads checksum file: `<UPLOADS_CHECKSUM_PATH>`
- manifest fields: relative path, size, modified time, checksum, and collection timestamp
- path safety: uploads source must not be production or 3106

### Migration Files Checksum

A later execution module must capture checksums for migration files before backup / restore verification:

- migration directory summary: `<MIGRATION_DIR_SUMMARY>`
- migration checksum manifest: `<MIGRATION_CHECKSUM_MANIFEST>`
- expected latest migration: `<EXPECTED_LATEST_MIGRATION>`
- current DB latest migration: `<CURRENT_DB_LATEST_MIGRATION>`

Mismatch between current DB migration status and repository migration files is a stop condition.

### Runtime And Config Snapshot

A later execution module must capture non-secret metadata only:

- app branch: `<APP_BRANCH>`
- app commit: `<APP_COMMIT>`
- runtime release label: `<RUNTIME_RELEASE_LABEL>`
- runtime root summary: `<RUNTIME_ROOT_SUMMARY>`
- service port label: `<SERVICE_PORT_LABEL>`
- non-secret env summary: `<NON_SECRET_ENV_SUMMARY>`
- feature flag snapshot: `<FEATURE_FLAG_SNAPSHOT>`
- rollback-relevant config snapshot: `<ROLLBACK_CONFIG_SNAPSHOT>`

Secrets, passwords, tokens, full DSNs, cookies, and Authorization headers must not be written to Git, logs, or evidence packets.

### Backup Storage

Required placeholders:

- storage label: `<BACKUP_STORAGE_SUMMARY>`
- storage owner: `<BACKUP_STORAGE_OWNER>`
- retention policy: `<RETENTION_POLICY>`
- naming convention: `<BACKUP_NAMING_CONVENTION>`
- disk space evidence: `<DISK_SPACE_EVIDENCE>`
- evidence artifact list: `<EVIDENCE_ARTIFACT_LIST>`

Backup artifacts must be outside Git and outside `.runtime` unless a later authorization explicitly names an approved operator storage path.

## 5. Restore Validation Scope

A later Module 3 execution, if separately authorized, may restore only into an isolated verification target.

Restore is forbidden into:

- production DB
- 3106 DB
- live staging DB
- any shared non-disposable database
- any target that could overwrite live data

Required restore validation scope:

- `pg_restore --list` review before restore execution
- restore target identity check
- schema and migration version check
- MVP table existence check
- row count and checksum sampling plan
- uploads manifest verification plan
- app health smoke checklist
- rollback readiness evidence
- evidence packet for monitor review

The isolated restore target must be named as:

- restore DB: `<RESTORE_VERIFY_DB>`
- restore host label: `<RESTORE_VERIFY_HOST>`
- restore port: `<RESTORE_VERIFY_PORT>`
- restore schema: `<RESTORE_VERIFY_SCHEMA>`
- restore operator role: `<RESTORE_OPERATOR_ROLE>`
- restore evidence path: `<RESTORE_EVIDENCE_PATH>`

## 6. Operator-Only Placeholder Templates

Every command in this section is a placeholder.

DO NOT EXECUTE IN THIS MODULE.  
Operator only after separate authorization.

### Staging DB Backup Placeholder

```powershell
pg_dump `
  --format=custom `
  --verbose `
  --no-password `
  --host "<STAGING_HOST>" `
  --port "<STAGING_PORT>" `
  --username "<READONLY_OR_BACKUP_ROLE>" `
  --dbname "<STAGING_DB>" `
  --file "<BACKUP_PATH>\<STAGING_DB>-<TIMESTAMP>.dump"
```

### Backup Checksum Placeholder

```powershell
Get-FileHash -Algorithm SHA256 "<BACKUP_PATH>\<STAGING_DB>-<TIMESTAMP>.dump" |
  Out-File "<BACKUP_PATH>\<STAGING_DB>-<TIMESTAMP>.dump.sha256"
```

### Backup Manifest Placeholder

```powershell
@{
  staging_db = "<STAGING_DB>"
  staging_host = "<STAGING_HOST>"
  staging_port = "<STAGING_PORT>"
  backup_artifact = "<BACKUP_PATH>\<STAGING_DB>-<TIMESTAMP>.dump"
  checksum_file = "<BACKUP_PATH>\<STAGING_DB>-<TIMESTAMP>.dump.sha256"
  app_commit = "<APP_COMMIT>"
  migration_latest = "<CURRENT_DB_LATEST_MIGRATION>"
  created_by = "<BACKUP_OPERATOR>"
  created_at = "<TIMESTAMP>"
} | ConvertTo-Json |
  Out-File "<MANIFEST_PATH>"
```

### `pg_restore --list` Placeholder

```powershell
pg_restore --list "<BACKUP_PATH>\<STAGING_DB>-<TIMESTAMP>.dump" |
  Out-File "<BACKUP_PATH>\<STAGING_DB>-<TIMESTAMP>.restore-list.txt"
```

### Isolated Restore Placeholder

```powershell
pg_restore `
  --verbose `
  --clean `
  --if-exists `
  --no-owner `
  --no-privileges `
  --host "<RESTORE_VERIFY_HOST>" `
  --port "<RESTORE_VERIFY_PORT>" `
  --username "<RESTORE_OPERATOR_ROLE>" `
  --dbname "<RESTORE_VERIFY_DB>" `
  "<BACKUP_PATH>\<STAGING_DB>-<TIMESTAMP>.dump"
```

### Restore Identity Check Placeholder

```powershell
psql `
  --host "<RESTORE_VERIFY_HOST>" `
  --port "<RESTORE_VERIFY_PORT>" `
  --username "<RESTORE_OPERATOR_ROLE>" `
  --dbname "<RESTORE_VERIFY_DB>" `
  -c "SELECT current_database(), current_user, current_schema();"
```

### Migration Status Check Placeholder

```powershell
psql `
  --host "<RESTORE_VERIFY_HOST>" `
  --port "<RESTORE_VERIFY_PORT>" `
  --username "<RESTORE_OPERATOR_ROLE>" `
  --dbname "<RESTORE_VERIFY_DB>" `
  -c "SELECT version, applied_at FROM <SCHEMA>.schema_migrations ORDER BY applied_at, version;"
```

### MVP Table Existence Placeholder

```powershell
psql `
  --host "<RESTORE_VERIFY_HOST>" `
  --port "<RESTORE_VERIFY_PORT>" `
  --username "<RESTORE_OPERATOR_ROLE>" `
  --dbname "<RESTORE_VERIFY_DB>" `
  -c "SELECT table_name FROM information_schema.tables WHERE table_schema = '<SCHEMA>' AND table_name IN ('generation_jobs','assets','library_items','provider_model_snapshots','api_call_logs','error_events','audit_logs','quota_accounts','quota_ledger') ORDER BY table_name;"
```

### Uploads Manifest Placeholder

```powershell
Get-ChildItem -LiteralPath "<UPLOADS_PATH>" -File -Recurse |
  Select-Object FullName, Length, LastWriteTime |
  ConvertTo-Json |
  Out-File "<MANIFEST_PATH>"
```

### Uploads Manifest Checksum Placeholder

```powershell
Get-FileHash -Algorithm SHA256 "<MANIFEST_PATH>" |
  Out-File "<MANIFEST_PATH>.sha256"
```

## 7. Go / No-Go Gate

Go only if all conditions are true:

- [ ] Module 1 PASS is accepted
- [ ] no production signal is present
- [ ] no 3106 signal is present
- [ ] backup target is confirmed
- [ ] restore verification target is confirmed isolated and disposable
- [ ] credentials owner is confirmed
- [ ] no secret exposure path exists
- [ ] upload path summary is confirmed without reading uploads in this module
- [ ] disk space is confirmed for backup and restore verification
- [ ] rollback owner is confirmed
- [ ] stop conditions are accepted by operator and decision owner
- [ ] user separate authorization for the exact execution module is obtained

No-go if any condition is false or unknown.

## 8. Stop Conditions

Stop immediately if any of the following are true:

- any production DB signal
- any 3106 signal
- backup target is ambiguous
- restore target might overwrite live DB
- restore target is not disposable
- credentials are too broad and not isolated
- credentials owner is unknown
- disk space is insufficient
- backup checksum cannot be generated
- manifest cannot be generated
- migration files and current DB migration status do not match
- uploads path identity is ambiguous
- uploads path could be production or 3106
- any required step would need a real write before authorization
- any command would print a secret, password, token, full DSN, cookie, or Authorization header
- `pg_restore --list` shows unexpected object ownership or a restore target risk
- 3107 health is abnormal before or after the authorized future operation
- operator cannot prove the target is staging-only

## 9. Module 3 Handoff Packet

The following non-sensitive packet must be provided before Module 3 can be considered.

```text
BACKUP_READY=yes/no
STAGING_DB_BACKUP_TARGET=<STAGING_DB_BACKUP_TARGET_SUMMARY>
STAGING_DB_NAME=<STAGING_DB>
STAGING_HOST_SUMMARY=<loopback/private/approved-host-label>
STAGING_PORT=<STAGING_PORT>
STAGING_SCHEMA=<SCHEMA>
BACKUP_ROLE_SUMMARY=<READONLY_OR_BACKUP_ROLE>
RESTORE_VERIFY_TARGET=<RESTORE_VERIFY_DB_SUMMARY>
RESTORE_VERIFY_IS_DISPOSABLE=yes/no
RESTORE_VERIFY_IS_ISOLATED=yes/no
UPLOADS_PATH_SUMMARY=<UPLOADS_PATH_SUMMARY>
BACKUP_STORAGE_SUMMARY=<BACKUP_STORAGE_SUMMARY>
DISK_SPACE_OK=yes/no
MIGRATION_LATEST_EXPECTED=<EXPECTED_LATEST_MIGRATION>
MIGRATION_LATEST_OBSERVED=<CURRENT_DB_LATEST_MIGRATION>
BACKUP_OPERATOR=<BACKUP_OPERATOR>
RESTORE_OPERATOR=<RESTORE_OPERATOR>
ROLLBACK_OWNER=<ROLLBACK_OWNER>
DECISION_OWNER=<DECISION_OWNER>
PRODUCTION_DB_EXCLUDED=yes/no
FORMAL_3106_EXCLUDED=yes/no
SECRETS_EXCLUDED_FROM_EVIDENCE=yes/no
AUTHORIZED_TO_EXECUTE_BACKUP_RESTORE=no
```

`AUTHORIZED_TO_EXECUTE_BACKUP_RESTORE` must remain `no` for this module.

## 10. Evidence Artifacts For A Future Authorized Module

Future authorized execution should produce only non-sensitive evidence:

- backup manifest summary
- backup checksum summary
- `pg_restore --list` summary
- restore target identity summary
- migration version summary
- MVP table existence summary
- row count sampling summary
- uploads manifest checksum summary
- non-secret app commit / runtime metadata summary
- 3107 health summary
- stop/go decision record
- rollback owner acknowledgement

Evidence must not include:

- password
- token
- full DSN
- cookie
- Authorization header
- raw provider response
- real uploads contents
- production host or production DB labels

## 11. PR Handling Boundary

This document is a plan-only artifact.

PR requirements:

- docs-only commit
- Draft PR only
- PR title: `Stage 9E-2 backup restore gate plan`
- do not mark ready for review without separate authorization
- do not merge without separate authorization
- PR description must state:
  - plan-only
  - no backup executed
  - no restore executed
  - no DB writes
  - no migration
  - no real uploads read or import
  - no 3106 touched
  - no NewAPI/provider call
  - no cost incurred

## 12. Final Gate For Module 2

Module 2 can pass only if:

- this document is the only module-specific change
- all commands remain placeholders
- no real backup was executed
- no real restore was executed
- no staging DB write occurred
- no production DB connection occurred
- no migration occurred
- no real uploads were read or imported
- local checks pass
- PR remains Draft if created
- no PR is merged

Passing Module 2 does not authorize Module 3, real backup / restore, staging migration, production DB access, or any 3106 operation.
