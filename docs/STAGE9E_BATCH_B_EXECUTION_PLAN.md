> Historical planning snapshot. This file records earlier 3107 database planning and does not describe the current 3106 server deployment.

# Stage 9E Batch B Execution Plan

Stage 9E Batch B is a planning and gated execution lane for staging-only backup, restore verification, migration, real uploads inventory dry-run, and DB/file consistency checks.

This document is plan-only until a later prompt explicitly authorizes a specific Batch B sub-stage. It does not execute backup, restore, migration, uploads inventory, database write, feature flag change, NewAPI call, provider call, generation, or cost-incurring work.

## Hard Boundary

Batch B is not a production cutover and is not a 3106 cutover.

The following boundaries apply to the whole batch:

- no 3106 operation, restart, publish, upgrade, rollback, or stop
- no production database connection
- no production migration
- no production database write
- no NewAPI call
- no real provider call
- no generation trigger
- no cost-incurring action
- no dual-write enablement
- no read-path switch to DB
- no feature flag change
- no Batch C work

Every execution command in this document is a placeholder. Replace placeholders only in an approved operator channel after separate authorization for that exact sub-stage. Do not commit real secrets, passwords, tokens, full DSNs, real hostnames, or production labels to Git.

## Current Preconditions

Before any Batch B sub-stage is authorized, re-confirm:

- [ ] worktree is `<local-3107-worktree>`
- [ ] current branch is the approved execution branch or `main` as specified by the authorization
- [ ] `main` and `origin/main` are aligned with the latest approved commit
- [ ] worktree is clean
- [ ] 3107 runtime commit matches the approved workspace commit
- [ ] 3107 health is normal
- [ ] 3106 remains untouched
- [ ] Stage 9E-1 read-only preflight evidence is accepted
- [ ] the least-privilege read-only role evidence remains available
- [ ] stop/go owner and rollback owner are named

## Batch B Scope

Batch B candidate sub-stages:

1. Stage 9E-2: staging backup and disposable restore verification
2. Stage 9E-3: staging migration rehearsal or staging migration
3. Stage 9E-4: real `data/uploads` inventory dry-run, read-only only
4. Stage 9E-5: DB/files consistency check
5. Dual-write recommendation gate, plan-only decision after Stage 9E-5 evidence

Batch B completion does not itself authorize Batch C, dual-write, read-path canary, or production work.

## Execution Sequence Recommendation

Run the sub-stages in this order, with separate authorization for each:

1. Stage 9E-2 backup creation and disposable restore verification
2. Stage 9E-3 staging migration, only after Stage 9E-2 evidence passes
3. Stage 9E-4 real uploads inventory dry-run, read-only only
4. Stage 9E-5 consistency check using the approved staging DB evidence and approved uploads inventory evidence
5. Batch B final gate report and monitor review
6. Dual-write or Batch C recommendation only, no implementation

Do not skip Stage 9E-2 before any staging migration.

## Actions Requiring Separate Authorization

The following actions must never be treated as implicitly approved:

- connect to staging DB with write-capable role
- create a real backup artifact
- execute a real restore
- create, drop, overwrite, or restore any database
- run staging migration
- read real `data/uploads`
- scan real uploads for inventory
- run consistency checks against real uploads
- write staging DB business data
- change database role privileges
- change feature flags
- enable dual-write
- switch read path to DB
- call NewAPI
- call a real provider
- trigger generation
- touch 3106
- connect to production DB
- run production migration
- incur cost

## Stage 9E-2: Staging Backup And Disposable Restore Verification

### Goal

Create an approved staging DB backup and verify it can be listed and restored into an explicitly disposable target. This proves rollback readiness before any staging migration.

### Allowed After Separate Authorization

- read approved staging DB identity
- create a staging DB backup artifact
- create or use an approved disposable restore target
- run `pg_restore --list` against the approved backup artifact
- restore into the approved disposable restore target
- run read-only verification queries on the disposable restore target
- capture manifest, checksum, and evidence summaries

### Forbidden

- production DB connection
- 3106 operation
- restore into a shared or non-disposable database
- migration
- app business table mutation outside the approved restore target
- real uploads read or import
- feature flag change
- NewAPI/provider/generation/cost
- any command using unapproved DSN, host, user, or database name

### Separate Authorization Must Name

- approved staging DB identity
- approved backup scope
- approved backup artifact location
- approved disposable restore target identity
- stop/go owner
- rollback owner
- operator
- maximum allowed runtime

### Involvement Matrix

- staging DB read: yes
- staging DB write: yes, only backup metadata access and restore target work as explicitly authorized
- real uploads read: no
- backup/restore: yes
- possible 3107 impact: low, but health must be checked before and after
- 3106 involved: no
- possible cost: no

### Approved Staging DB Identity Checklist

Record only non-sensitive values in Git:

- [ ] host label = `<STAGING_HOST_LABEL>`
- [ ] port = `<STAGING_PORT>`
- [ ] database name = `<STAGING_DB>`
- [ ] schema = `<STAGING_SCHEMA>`
- [ ] role = `<BACKUP_ROLE_OR_OPERATOR_ROLE>`
- [ ] expected environment = `<STAGING_ENVIRONMENT_LABEL>`
- [ ] target is not production
- [ ] target is not 3106
- [ ] target is the same staging DB accepted by Stage 9E-1
- [ ] owner confirms backup may be taken

### Approved Disposable Restore Target Identity Checklist

- [ ] host label = `<RESTORE_HOST_LABEL>`
- [ ] port = `<RESTORE_PORT>`
- [ ] database name = `<DISPOSABLE_RESTORE_DB>`
- [ ] schema = `<RESTORE_SCHEMA>`
- [ ] restore role = `<RESTORE_OPERATOR_ROLE>`
- [ ] target is disposable
- [ ] target is isolated from 3107 live traffic
- [ ] target is not production
- [ ] target is not 3106
- [ ] target can be dropped or cleaned by the rollback owner after authorization

### Placeholder Artifacts

- backup artifact = `<BACKUP_ARTIFACT>`
- backup manifest = `<BACKUP_MANIFEST>`
- backup checksum = `<BACKUP_CHECKSUM>`
- restore evidence file = `<RESTORE_EVIDENCE>`
- `pg_restore --list` output = `<PG_RESTORE_LIST_OUTPUT>`

### Placeholder Commands

Do not execute without separate authorization.

```powershell
pg_dump `
  --format=custom `
  --verbose `
  --file "<BACKUP_ARTIFACT>" `
  "<APPROVED_STAGING_DSN>"
```

```powershell
Get-FileHash -Algorithm SHA256 "<BACKUP_ARTIFACT>" |
  Out-File "<BACKUP_CHECKSUM>"
```

```powershell
pg_restore --list "<BACKUP_ARTIFACT>" |
  Out-File "<PG_RESTORE_LIST_OUTPUT>"
```

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

```powershell
psql "<APPROVED_DISPOSABLE_RESTORE_DSN>" `
  -c "SELECT current_database(), current_user, current_schema();"
```

```powershell
psql "<APPROVED_DISPOSABLE_RESTORE_DSN>" `
  -c "SELECT COUNT(*) AS migration_rows FROM <STAGING_SCHEMA>.schema_migrations;"
```

### Go / No-Go Checklist

Go only if:

- [ ] Stage 9E-1 evidence is accepted
- [ ] staging DB identity matches approved evidence
- [ ] restore target is disposable
- [ ] artifact path is outside Git and outside `.runtime`
- [ ] checksum path is approved
- [ ] stop/go owner is present
- [ ] rollback owner is present
- [ ] no production signal is present
- [ ] 3107 health is normal before start

No-go if:

- [ ] target identity mismatch
- [ ] production signal
- [ ] restore target is not disposable
- [ ] checksum mismatch
- [ ] backup artifact missing
- [ ] `pg_restore --list` output is unavailable
- [ ] unexpected destructive action is required
- [ ] operator would need to touch 3106

### Stop Conditions

Stop immediately if:

- target identity mismatch
- production signal
- restore target not disposable
- checksum mismatch
- backup artifact missing
- `pg_restore --list` contains unexpected object ownership or destructive surprises
- restore attempts to affect a non-target database
- 3107 health regresses
- secret, password, token, or full DSN would be printed

### Rollback / Recovery Strategy

- Do not roll back production or 3106.
- Preserve the backup artifact, manifest, checksum, and restore logs.
- If restore fails, leave the disposable target untouched for operator inspection unless the rollback owner separately authorizes cleanup.
- If cleanup is authorized later, use only the approved disposable target identity.
- If 3107 health regresses, stop Batch B and report; do not self-heal by changing 3106 or feature flags.

### Evidence Required Before Moving To Migration

- [ ] staging DB identity summary
- [ ] backup artifact name and size summary, no path secrets
- [ ] checksum algorithm and checksum status
- [ ] `pg_restore --list` reviewed
- [ ] disposable restore target identity summary
- [ ] restore verification query summary
- [ ] 3107 health before and after
- [ ] no production / no 3106 confirmation
- [ ] no NewAPI/provider/generation/cost confirmation

### Fields To Report To Monitor

- stage = `Stage 9E-2`
- backup status
- restore status
- checksum status
- restore target disposable = yes/no
- 3107 health before/after
- production touched = no
- 3106 touched = no
- migration executed = no
- uploads read = no
- cost incurred = no
- recommendation for Stage 9E-3 = proceed / hold

## Stage 9E-3: Staging Migration Plan

### Goal

Run the approved staging migration only after backup and disposable restore verification pass. The migration target must be staging only.

### Allowed After Separate Authorization

- connect to approved staging DB
- use an approved migration operator role
- run the approved migration command
- run read-only post-migration verification queries
- run 3107 health checks after migration
- capture migration evidence

### Forbidden

- production DB connection
- production migration
- 3106 operation
- migration before Stage 9E-2 evidence passes
- feature flag change
- real uploads read/import
- dual-write enablement
- read-path switch
- NewAPI/provider/generation/cost
- manual DDL outside the approved migration command

### Separate Authorization Must Name

- exact migration command
- approved staging DB identity
- approved migration role
- allowed write scope
- accepted destructive migration tokens
- backup artifact and restore evidence from Stage 9E-2
- stop/go owner
- rollback owner

### Involvement Matrix

- staging DB read: yes
- staging DB write: yes
- real uploads read: no
- backup/restore: no new restore unless rollback is separately authorized
- possible 3107 impact: yes
- 3106 involved: no
- possible cost: no

### Required Preconditions

- [ ] Stage 9E-2 backup evidence accepted
- [ ] Stage 9E-2 disposable restore verification accepted
- [ ] destructive migration tokens reviewed
- [ ] feature flags still default safe
- [ ] 3107 health normal
- [ ] no production DB target
- [ ] no 3106 involvement
- [ ] rollback owner present
- [ ] stop/go owner present

### Destructive Migration Token Review

Stage 9D found destructive tokens in migration files. Before Stage 9E-3, the authorization must explicitly acknowledge:

- destructive token list reviewed
- affected migration files named
- expected operations understood
- rollback path is backup/restore based
- no migration runs against production
- no migration runs against 3106

### Placeholder Commands

Do not execute without separate authorization.

```powershell
npm run db:migrate:status -- `
  --database-url "<APPROVED_STAGING_DSN>" `
  --expected-name "<STAGING_DB>"
```

```powershell
npm run db:migrate -- `
  --database-url "<APPROVED_STAGING_DSN>" `
  --expected-name "<STAGING_DB>"
```

```powershell
psql "<APPROVED_STAGING_DSN>" `
  -c "SELECT version, applied_at FROM <STAGING_SCHEMA>.schema_migrations ORDER BY applied_at;"
```

```powershell
npm run service:health -- staging --repeat 3
```

### Go / No-Go Checklist

Go only if:

- [ ] Stage 9E-2 evidence is complete
- [ ] staging DB identity matches approved target
- [ ] backup artifact is available
- [ ] restore verification passed
- [ ] migration command is exact and approved
- [ ] destructive tokens are accepted by decision owner
- [ ] feature flags are unchanged and fail-closed
- [ ] 3107 health is normal

No-go if:

- [ ] backup/restore verification incomplete
- [ ] DB identity mismatch
- [ ] production signal
- [ ] destructive token review incomplete
- [ ] rollback owner absent
- [ ] 3107 health already degraded

### Stop Conditions

Stop immediately if:

- backup/restore not complete
- DB identity mismatch
- migration failure
- unexpected destructive operation
- production signal
- 3107 health regression
- migration asks for a broader permission than authorized
- migration output contains secrets

### Rollback / Recovery Strategy

- Stop Batch B and preserve logs.
- Do not self-run restore unless rollback restore is separately authorized.
- Recommend restore from the approved Stage 9E-2 backup into the approved target or a replacement staging target.
- Keep feature flags disabled unless separately authorized.
- Keep 3106 untouched.

### Evidence Checklist

- [ ] migration command used
- [ ] migration target identity summary
- [ ] migration result
- [ ] applied migrations before/after
- [ ] destructive token acknowledgement
- [ ] 3107 health before/after
- [ ] feature flag state after migration
- [ ] no production / no 3106 confirmation
- [ ] no provider/cost confirmation

### Fields To Report To Monitor

- stage = `Stage 9E-3`
- migration executed = yes/no
- migration result
- migration version before
- migration version after
- destructive tokens acknowledged = yes/no
- rollback required = yes/no
- 3107 health before/after
- feature flags changed = no
- production touched = no
- 3106 touched = no
- recommendation for Stage 9E-4 = proceed / hold

## Stage 9E-4: Real Uploads Inventory Dry-Run Plan

### Goal

Prepare a read-only inventory of approved real `data/uploads` or staging uploads roots without import, move, delete, repair, or modification.

### Allowed After Separate Authorization

- read approved uploads root metadata
- count files and directories
- summarize size and extensions
- optionally compute approved checksums
- detect path escapes
- list missing/orphan candidates as evidence only

### Forbidden

- import
- move
- delete
- modify
- repair
- chmod or ownership changes
- writing manifests into the real uploads root
- reading unapproved roots
- staging DB write
- production DB connection
- 3106 operation
- NewAPI/provider/generation/cost

### Separate Authorization Must Name

- exact approved uploads root
- allowed inventory fields
- checksum strategy, if any
- output path outside real uploads
- maximum scan depth or maximum runtime if needed
- stop/go owner

### Involvement Matrix

- staging DB read: no, unless explicitly paired with Stage 9E-5 later
- staging DB write: no
- real uploads read: yes
- backup/restore: no
- possible 3107 impact: low, but I/O pressure must be bounded
- 3106 involved: no
- possible cost: no

### Inventory Fields

- file count
- directory count
- size summary
- extension summary
- checksum strategy
- path escape detection
- unreadable file count
- missing/orphan candidate list
- duplicate path candidate list
- suspicious path traversal candidate list

### Placeholder Commands

Do not execute without separate authorization.

```powershell
node scripts/database/plan-library-import.mjs `
  --uploads-root "<APPROVED_UPLOADS_ROOT>" `
  --inventory-only `
  --dry-run `
  --output "<UPLOADS_INVENTORY_OUTPUT>"
```

```powershell
node scripts/database/check-library-db-file-consistency.mjs `
  --uploads-inventory "<UPLOADS_INVENTORY_OUTPUT>" `
  --dry-run `
  --no-repair
```

### Go / No-Go Checklist

Go only if:

- [ ] uploads root identity is approved
- [ ] root is not production unless production read has been separately authorized
- [ ] root is not 3106 unless 3106 read has been separately authorized; expected answer for Batch B is no
- [ ] output path is outside real uploads
- [ ] read-only command is confirmed
- [ ] no import or repair flag is present

No-go if:

- [ ] root path is ambiguous
- [ ] root may be production or 3106
- [ ] output would be written under uploads
- [ ] command includes import, repair, delete, move, or modify behavior

### Stop Conditions

Stop immediately if:

- path outside approved root
- unexpected huge count or size
- unreadable files exceed approved threshold
- suspicious path traversal
- mutation attempt
- scan would require provider or NewAPI call
- scan would create cost

### Rollback / Recovery Strategy

No mutation is allowed, so rollback should not be needed. If any mutation is detected or suspected:

- stop immediately
- preserve command output and timestamps
- do not self-repair
- report the suspected path and action to the monitor

### Evidence Checklist

- [ ] approved root summary
- [ ] file count
- [ ] directory count
- [ ] size summary
- [ ] extension summary
- [ ] checksum strategy status
- [ ] path escape findings
- [ ] unreadable file summary
- [ ] mutation occurred = no
- [ ] no production / no 3106 confirmation

### Fields To Report To Monitor

- stage = `Stage 9E-4`
- uploads root summary
- inventory mode = read-only
- file count
- directory count
- size summary
- extension summary
- checksum status
- path escape findings
- mutation occurred = no
- production touched = no
- 3106 touched = no
- recommendation for Stage 9E-5 = proceed / hold

## Stage 9E-5: DB / Files Consistency Check Plan

### Goal

Compare approved staging DB metadata with approved uploads inventory evidence. Classify mismatches without repair, deletion, or write.

### Allowed After Separate Authorization

- staging DB read using approved role
- approved uploads inventory read
- static classification of mismatches
- report-only consistency output

### Forbidden

- repair
- delete
- DB write
- file write under uploads
- import
- migration
- feature flag change
- dual-write enablement
- read-path switch
- production DB connection
- 3106 operation
- NewAPI/provider/generation/cost

### Separate Authorization Must Name

- approved staging DB role
- approved DB tables to read
- approved uploads inventory evidence file
- output path outside real uploads and outside secrets
- stop/go owner
- decision criteria for dual-write recommendation

### Involvement Matrix

- staging DB read: yes
- staging DB write: no
- real uploads read: yes, only through approved inventory or separately authorized read-only root
- backup/restore: no
- possible 3107 impact: low
- 3106 involved: no
- possible cost: no

### Inputs

- Stage 9E-3 migration evidence, if migration was executed
- Stage 9E-4 uploads inventory output
- approved staging DB identity summary
- approved table list
- approved consistency output path

### Mismatch Classes

- DB record without file
- file without DB record
- duplicate asset
- checksum mismatch
- metadata mismatch
- path escape
- unreadable file reference
- stale job reference

### Placeholder Commands

Do not execute without separate authorization.

```powershell
node scripts/database/check-library-db-file-consistency.mjs `
  --database-url "<APPROVED_STAGING_READONLY_DSN>" `
  --expected-name "<STAGING_DB>" `
  --uploads-inventory "<UPLOADS_INVENTORY_OUTPUT>" `
  --mode "read-only" `
  --no-repair `
  --output "<CONSISTENCY_OUTPUT>"
```

### Go / No-Go Checklist

Go only if:

- [ ] Stage 9E-4 inventory evidence is accepted
- [ ] staging DB read identity is approved
- [ ] tables to read are approved
- [ ] command is read-only
- [ ] output path is approved
- [ ] 3107 health is normal

No-go if:

- [ ] DB identity mismatch
- [ ] uploads inventory missing or stale
- [ ] command would repair, delete, import, or write
- [ ] production signal
- [ ] 3106 involvement

### Stop Conditions

Stop immediately if:

- DB identity mismatch
- production signal
- uploads root mismatch
- command asks for write permission
- repair/delete/import path is triggered
- mismatch volume exceeds approved review threshold
- output contains secrets or full DSN

### Rollback / Recovery Strategy

No mutation is allowed. If a mutation is detected:

- stop immediately
- preserve evidence
- do not self-repair
- report impact and recommended manual recovery path

### Evidence Checklist

- [ ] DB identity summary
- [ ] table read list
- [ ] uploads inventory input summary
- [ ] mismatch counts by class
- [ ] sample mismatch references redacted and safe
- [ ] repair/delete/write = no
- [ ] feature flags changed = no
- [ ] 3107 health before/after
- [ ] no production / no 3106 confirmation

### Fields To Report To Monitor

- stage = `Stage 9E-5`
- consistency result
- mismatch counts by class
- DB read-only role
- uploads inventory source summary
- repair/delete/write occurred = no
- 3107 health before/after
- production touched = no
- 3106 touched = no
- recommendation for dual-write = proceed / hold

## Dual-Write Recommendation Gate

Batch B can only recommend whether a future dual-write proposal is worth reviewing. It must not enable dual-write.

Recommend `hold` if any of the following are true:

- Stage 9E-2 backup/restore evidence is incomplete
- Stage 9E-3 migration failed or is incomplete
- Stage 9E-4 inventory evidence is missing or risky
- Stage 9E-5 mismatch counts exceed the approved threshold
- 3107 health regressed
- feature flags changed unexpectedly
- production or 3106 was touched
- NewAPI/provider/generation/cost was triggered

Recommend `proceed to separate dual-write planning` only if:

- backup/restore evidence passed
- migration evidence passed, if migration was authorized
- inventory evidence passed
- consistency evidence passed
- mismatch risk is low and accepted
- 3107 health is normal
- feature flags remain safe
- production and 3106 remain untouched

Proceeding still requires a separate Batch C or dual-write authorization.

## Batch B Final Report Format

The final Batch B report must include:

```text
Batch B status: PASS / PARTIAL / BLOCKED

Backup / restore evidence:
- backup executed: yes/no
- restore executed: yes/no
- backup artifact summary:
- checksum status:
- pg_restore list reviewed:
- disposable restore target verified:

Migration result:
- migration executed: yes/no
- staging DB identity:
- migration version before:
- migration version after:
- destructive tokens acknowledged:
- rollback required:

Uploads inventory dry-run result:
- real uploads read: yes/no
- approved root summary:
- file count:
- directory count:
- size summary:
- extension summary:
- path escape findings:
- mutation occurred: no

Consistency check result:
- DB read role:
- uploads inventory input:
- mismatch counts by class:
- repair/delete/write occurred: no
- recommendation for dual-write:

3107 health:
- runtime commit:
- health before:
- health after:
- newApiCalled:

Feature flags:
- dual-write enabled: no
- read path switched to DB: no
- other DB feature flags changed: no

Safety:
- production DB touched: no
- 3106 touched: no
- NewAPI/provider called: no
- generation triggered: no
- cost incurred: no

Recommendation:
- enter Batch C / dual-write planning: yes/no
- required separate authorization:
```

## Draft PR Description Template

```markdown
## Summary

- Add Stage 9E Batch B execution plan
- Define Stage 9E-2 backup / disposable restore verification gates
- Define Stage 9E-3 staging migration gates
- Define Stage 9E-4 real uploads inventory dry-run gates
- Define Stage 9E-5 DB/files consistency gates

## Safety

- planning only
- no backup executed
- no restore executed
- no migration
- no DB write
- no real uploads read
- no production DB
- no 3106 operation
- no NewAPI/provider/generation/cost
- Batch B implementation requires separate authorization

## Checks

- npm run lint
- npm run typecheck
- npm run check
- git diff --check
```
