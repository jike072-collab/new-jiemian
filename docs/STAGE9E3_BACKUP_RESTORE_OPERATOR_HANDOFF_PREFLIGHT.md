# Stage 9E-3 Backup Restore Operator Handoff Preflight

Module 3 is a docs-only operator handoff preflight for a later separately authorized staging backup / restore verification. It turns the required non-sensitive operator inputs, authorization boundaries, target confirmations, stop conditions, and evidence receipt format into a reviewable checklist.

This module does not execute backup, restore, `pg_dump`, `pg_restore`, migration, database writes, database connections, uploads access, feature flag changes, NewAPI calls, provider calls, generation, cost-incurring work, or 3106 operations.

## 1. Goal And Boundary

Module 3 scope:

- define the operator handoff packet required before real backup / restore can be considered
- define the non-sensitive evidence packet required around any future authorized execution
- define placeholder-only operator command classes
- define go / no-go and stop conditions before real execution
- define the Module 4 handoff packet

Module 3 exclusions:

- no real backup execution
- no real restore execution
- no `pg_dump` execution
- no `pg_restore` execution
- no production DB connection
- no staging DB connection
- no staging DB write
- no production DB write
- no staging or production migration
- no database creation, deletion, overwrite, or restore
- no real `data/uploads` read, import, move, delete, or modification
- no 3106 operation, restart, publish, upgrade, rollback, or stop
- no dual-write enablement
- no read path switch
- no feature flag change
- no NewAPI or provider call
- no real generation
- no cost-incurring action
- no Module 4 execution

## 2. Inherited Module 2 Gate Plan

This handoff preflight inherits the approved Module 2 plan from:

```text
docs/STAGE9E2_BACKUP_RESTORE_GATE_PLAN.md
```

Module 2 already defines the backup / restore gate plan, backup scope, isolated restore verification scope, operator-only placeholder templates, go / no-go conditions, stop conditions, and a Module 3 handoff packet.

Module 3 does not execute that plan. Module 3 only makes the operator's pre-execution handoff information, authorization boundary, and evidence receipt format explicit.

Real backup / restore execution still requires separate user authorization. The current value must remain:

```text
AUTHORIZED_TO_EXECUTE_BACKUP_RESTORE=no
```

## 3. Operator Handoff Required Fields

The operator must provide the following non-sensitive handoff before any future execution module is considered.

```text
MODULE3_OPERATOR_HANDOFF_READY=yes/no

STAGING_DB_NAME=
STAGING_DB_HOST_SUMMARY=loopback/private/approved-host-label
STAGING_DB_PORT=
STAGING_DB_SCHEMA=
STAGING_DB_EXPECTED_NAME_MATCHES=yes/no
STAGING_DB_PRODUCTION_SIGNAL=no/yes/unknown

BACKUP_OPERATOR=
RESTORE_OPERATOR=
BACKUP_ROLE_SUMMARY=
RESTORE_ROLE_SUMMARY=
ROLE_SUPERUSER=no/yes/unknown
ROLE_CREATEDB=no/yes/unknown
ROLE_CREATEROLE=no/yes/unknown
ROLE_REPLICATION=no/yes/unknown
ROLE_BYPASSRLS=no/yes/unknown

BACKUP_STORAGE_SUMMARY=
BACKUP_PATH_PLACEHOLDER=
BACKUP_RETENTION_POLICY_SUMMARY=
BACKUP_ENCRYPTION_OR_ACCESS_CONTROL_SUMMARY=
DISK_SPACE_OK=yes/no/unknown

RESTORE_VERIFY_TARGET=
RESTORE_VERIFY_TARGET_IS_ISOLATED=yes/no/unknown
RESTORE_VERIFY_TARGET_CAN_OVERWRITE_LIVE_DB=no/yes/unknown
RESTORE_VERIFY_DB_NAME=
RESTORE_VERIFY_HOST_SUMMARY=

UPLOADS_PATH_SUMMARY=
UPLOADS_MANIFEST_TARGET=
UPLOADS_CHECKSUM_METHOD=
UPLOADS_PRODUCTION_PATH_EXCLUDED=yes/no/unknown

MIGRATION_FILES_CHECKSUM_READY=yes/no
APP_COMMIT_SNAPSHOT_READY=yes/no
NON_SECRET_ENV_SNAPSHOT_READY=yes/no
FEATURE_FLAGS_SNAPSHOT_READY=yes/no
ROLLBACK_OWNER=
ROLLBACK_CONTACT=
STOP_CONDITIONS_ACCEPTED=yes/no

PRODUCTION_DB_EXCLUDED=yes/no
FORMAL_3106_EXCLUDED=yes/no
AUTHORIZED_TO_EXECUTE_BACKUP_RESTORE=no
```

`AUTHORIZED_TO_EXECUTE_BACKUP_RESTORE` must be `no` in this module.

## 4. Operator Evidence Packet

This section defines the later evidence receipt structure only. It is not execution evidence for this module.

A future separately authorized execution must return only non-sensitive evidence:

```text
OPERATOR_EVIDENCE_PACKET_READY=yes/no

BACKUP_COMMAND_CLASS_USED=<pg_dump/custom/logical/other-summary>
BACKUP_COMMAND_REDACTED=yes/no
BACKUP_ARTIFACT_SUMMARY=
BACKUP_TIMESTAMP=
BACKUP_SIZE_SUMMARY=
BACKUP_CHECKSUM_SUMMARY=
BACKUP_MANIFEST_SUMMARY=

PG_RESTORE_LIST_RESULT_SUMMARY=
RESTORE_TARGET_IDENTITY_SUMMARY=
RESTORE_TARGET_ISOLATED=yes/no
RESTORE_TARGET_OVERWROTE_LIVE_DB=no/yes/unknown

MIGRATION_VERSION_OBSERVED=
MVP_TABLE_EXISTENCE_SUMMARY=
ROW_COUNT_SAMPLING_SUMMARY=
CHECKSUM_SAMPLING_SUMMARY=
UPLOADS_MANIFEST_VERIFICATION_SUMMARY=

APP_SMOKE_RESULT_SUMMARY=
ROLLBACK_READINESS_SUMMARY=
OPERATOR_SIGNOFF=
STOP_CONDITION_TRIGGERED=yes/no
STOP_CONDITION_DETAILS=

SECRETS_EXCLUDED_FROM_EVIDENCE=yes/no
PRODUCTION_DB_EXCLUDED=yes/no
FORMAL_3106_EXCLUDED=yes/no
NEWAPI_PROVIDER_EXCLUDED=yes/no
COST_INCURRED=no/yes/unknown
```

Evidence must not include:

- password
- token
- secret
- full DSN
- cookie
- Authorization header
- raw provider response
- real uploads file contents
- production DB connection details
- 3106 operational details beyond exclusion confirmation

## 5. Operator-Only Placeholder Templates

Every command in this section is a placeholder.

DO NOT EXECUTE IN THIS MODULE.  
Operator only after separate user authorization.

All variables must remain placeholders. Do not replace them with real DSNs, passwords, tokens, secrets, or production paths in Git, PRs, logs, or chat output.

### `pg_dump` Placeholder

```powershell
pg_dump `
  --format=custom `
  --verbose `
  --no-password `
  --host "<STAGING_HOST>" `
  --port "<STAGING_PORT>" `
  --username "<BACKUP_ROLE>" `
  --dbname "<STAGING_DB>" `
  --file "<BACKUP_PATH>\<STAGING_DB>-<TIMESTAMP>.dump"
```

### Backup Checksum Placeholder

```powershell
Get-FileHash -Algorithm SHA256 "<BACKUP_PATH>\<STAGING_DB>-<TIMESTAMP>.dump" |
  Out-File "<CHECKSUM_PATH>"
```

### `pg_restore --list` Placeholder

```powershell
pg_restore --list "<BACKUP_PATH>\<STAGING_DB>-<TIMESTAMP>.dump" |
  Out-File "<MANIFEST_PATH>"
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
  --username "<RESTORE_ROLE>" `
  --dbname "<RESTORE_VERIFY_DB>" `
  "<BACKUP_PATH>\<STAGING_DB>-<TIMESTAMP>.dump"
```

### Restore Identity Placeholder

```powershell
psql `
  --host "<RESTORE_VERIFY_HOST>" `
  --username "<RESTORE_ROLE>" `
  --dbname "<RESTORE_VERIFY_DB>" `
  -c "SELECT current_database(), current_user, current_schema();"
```

### Migration Checksum Placeholder

```powershell
Get-ChildItem -LiteralPath "<MIGRATION_PATH>" -File |
  Get-FileHash -Algorithm SHA256 |
  Out-File "<CHECKSUM_PATH>"
```

### Uploads Manifest Placeholder

```powershell
Get-ChildItem -LiteralPath "<UPLOADS_PATH>" -File -Recurse |
  Select-Object FullName, Length, LastWriteTime |
  ConvertTo-Json |
  Out-File "<MANIFEST_PATH>"
```

### Non-Secret Environment Snapshot Placeholder

```powershell
@{
  app_commit = "<APP_COMMIT>"
  feature_flags = "<FEATURE_FLAGS_SUMMARY>"
  database_target = "<STAGING_DB>"
  restore_target = "<RESTORE_VERIFY_DB>"
  uploads_summary = "<UPLOADS_PATH_SUMMARY>"
} | ConvertTo-Json |
  Out-File "<MANIFEST_PATH>"
```

## 6. Go / No-Go Checklist Before Real Execution

Real execution remains forbidden until a later prompt explicitly authorizes it. Before that authorization can be considered, every item below must be true:

- [ ] Module 1 PASS is accepted
- [ ] Module 2 PASS is accepted
- [ ] Module 3 handoff packet is complete
- [ ] no production signal is present
- [ ] 3106 is excluded
- [ ] staging DB identity is confirmed
- [ ] restore verification target is isolated
- [ ] restore target cannot overwrite live DB
- [ ] backup storage is confirmed
- [ ] disk space is confirmed
- [ ] credentials owner is confirmed
- [ ] secret exposure path is avoided
- [ ] uploads path summary is confirmed without reading uploads in this module
- [ ] manifest method is confirmed
- [ ] checksum method is confirmed
- [ ] migration file checksum plan is confirmed
- [ ] app commit snapshot plan is confirmed
- [ ] non-secret env snapshot plan is confirmed
- [ ] rollback owner is confirmed
- [ ] stop conditions are accepted
- [ ] separate user authorization for real backup / restore is obtained

No-go if any item is false or unknown.

## 7. Stop Conditions

Stop immediately if any condition is observed:

- any production DB signal
- any 3106 signal
- restore target might overwrite live DB
- staging identity is unclear
- backup path is unclear
- uploads path is unclear
- credentials are too broad and not isolated
- credentials owner is unknown
- secret appears in logs, docs, PR, command output, or chat
- disk space is insufficient
- manifest cannot be generated
- checksum cannot be generated
- migration files and DB state do not match
- real write would be required to continue
- operator cannot confirm isolated target
- operator cannot confirm production DB exclusion
- operator cannot confirm formal 3106 exclusion
- `AUTHORIZED_TO_EXECUTE_BACKUP_RESTORE` is anything other than `no` in this module

## 8. Module 4 Handoff Packet

Module 4 is not authorized by this module. This packet is a future handoff template only.

```text
MODULE4_READY=yes/no
MODULE3_HANDOFF_REVIEWED=yes/no
REAL_BACKUP_RESTORE_AUTHORIZED=no
STAGING_DB_CONFIRMED=yes/no
RESTORE_VERIFY_TARGET_CONFIRMED=yes/no
UPLOADS_MANIFEST_CONFIRMED=yes/no
OPERATOR_SIGNOFF=yes/no
SUPERVISOR_APPROVAL_REQUIRED=yes
```

`REAL_BACKUP_RESTORE_AUTHORIZED` must be `no` in this module.

## 9. PR Handling Boundary

This document is a docs-only preflight artifact.

PR requirements:

- docs-only commit
- Draft PR only
- PR title: `Stage 9E-3 backup restore operator handoff preflight`
- do not mark ready for review without separate authorization
- do not merge without separate authorization
- PR description must state:
  - docs-only
  - no backup executed
  - no restore executed
  - no DB connection
  - no DB writes
  - no uploads touched
  - no 3106 touched
  - no NewAPI/provider call
  - no cost incurred

## 10. Final Gate For Module 3

Module 3 can pass only if:

- this document is the only module-specific change
- all commands remain placeholders
- no real backup was executed
- no real restore was executed
- no `pg_dump` was executed
- no `pg_restore` was executed
- no staging DB connection occurred
- no production DB connection occurred
- no migration occurred
- no real uploads were read or imported
- local checks pass
- PR remains Draft if created
- no PR is merged

Passing Module 3 does not authorize Module 4, real backup / restore, staging migration, production DB access, or any 3106 operation.
