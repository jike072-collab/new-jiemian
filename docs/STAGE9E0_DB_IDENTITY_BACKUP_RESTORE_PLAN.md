# Stage 9E-0 DB Identity Backup Restore Plan

Stage 9E-0 is a plan-only stage. It prepares the identity, backup, and restore rehearsal checklist that must be complete before any future staging database action is considered.

Stage 9E-0 does not connect to staging or production databases. It does not run migration commands, write database rows, restore a dump, or read real `data/uploads`.

## Hard Boundary

Stage 9E-0 must stay true to all of the following:

- no staging database connection
- no production database connection
- no staging migration
- no production migration
- no staging database write
- no production database write
- no restore execution
- no real `data/uploads` read, import, move, delete, or modification
- no feature flag cutover
- no 3106 publish, restart, stop, rollback, or upgrade
- no NewAPI call
- no real provider call
- no generation cost

## Goal

Stage 9E-0 exists to document:

1. the exact database identity fields that must be confirmed before any future connection
2. the backup artifact and checksum expectations before any future staging write
3. the restore rehearsal checkpoints that must be satisfied before any future staging migration
4. the explicit authorization text required before Stage 9E-1, Stage 9E-2, or Stage 9E-3 may start

Passing Stage 9E-0 means the plan is reviewable. It does not authorize Stage 9E-1 or any real database action.

## Staging DB Identity Checklist

Do not fill these values in Git with real secrets. Record them in the approved operator channel only after separate authorization for Stage 9E-1.

- [ ] host is named as `<db-host-placeholder>`
- [ ] port is named as `<db-port-placeholder>`
- [ ] database name is named as `<db-name-placeholder>`
- [ ] username is named as `<db-user-placeholder>`
- [ ] role is named as `<db-role-placeholder>`
- [ ] schema is named as `<db-schema-placeholder>`
- [ ] environment label is named as `<environment-label-placeholder>`
- [ ] expected app or project is named as `<app-or-project-placeholder>`
- [ ] expected read permission is named as `<read-permission-placeholder>`
- [ ] expected write permission is named as `<write-permission-placeholder>`
- [ ] target is explicitly marked disposable or non-disposable as `<target-disposability-placeholder>`
- [ ] target is explicitly marked restorable or non-restorable as `<target-restorability-placeholder>`
- [ ] stop/go decision owner is named as `<decision-owner-placeholder>`
- [ ] rollback owner is named as `<rollback-owner-placeholder>`
- [ ] operator executing any future command is named as `<operator-placeholder>`
- [ ] target is explicitly confirmed not to be production
- [ ] target is explicitly confirmed not to be 3106
- [ ] target naming convention is reviewed for collisions with production, 3106, 3107, or shared long-lived databases

## Backup Checklist

Before any future staging write or migration authorization:

- [ ] backup scope is documented: schema only, data only, or full logical dump
- [ ] backup command owner is named
- [ ] backup output path is documented outside Git and outside `.runtime`
- [ ] backup artifact naming format is documented
- [ ] checksum command and checksum output format are documented
- [ ] backup manifest fields are documented
- [ ] retention window is documented
- [ ] restore target owner is named
- [ ] restore target is documented as disposable and isolated
- [ ] `pg_restore --list` review is required before any restore execution
- [ ] backup storage location is confirmed readable by rollback owner
- [ ] backup plan explicitly states that Stage 9E-0 does not execute the backup

## Restore Rehearsal Checklist

Before any future restore rehearsal authorization:

- [ ] restore target identity is documented with host, port, database name, user, role, and schema placeholders
- [ ] restore target is confirmed disposable
- [ ] restore target is confirmed isolated from shared staging traffic
- [ ] restore target is confirmed restorable without touching production or 3106
- [ ] rollback owner is present for the rehearsal window
- [ ] stop conditions are acknowledged by operator and decision owner
- [ ] backup manifest and checksum files are available
- [ ] `pg_restore --list` output is reviewed before restore execution
- [ ] restore verification query set is documented
- [ ] restore rehearsal output location is documented outside Git
- [ ] Stage 9E-0 plan explicitly states that no restore is executed in this stage

## Placeholder Command Templates

The following commands are templates only. Do not execute them in Stage 9E-0.

### `pg_dump`

```powershell
pg_dump `
  --format=custom `
  --verbose `
  --file "<backup-file-placeholder>.dump" `
  "<database-url-placeholder>"
```

### `pg_restore --list`

```powershell
pg_restore --list "<backup-file-placeholder>.dump"
```

### Restore Execution Template

```powershell
pg_restore `
  --verbose `
  --clean `
  --if-exists `
  --no-owner `
  --no-privileges `
  --dbname "<restore-target-database-url-placeholder>" `
  "<backup-file-placeholder>.dump"
```

### Restore Verification Template

```powershell
psql "<restore-target-database-url-placeholder>" -c "SELECT current_database(), current_user, current_schema();"
psql "<restore-target-database-url-placeholder>" -c "SELECT now();"
```

Every placeholder above must be resolved outside Git, outside logs, and outside `.runtime` only after the relevant later stage is explicitly authorized.

## Known Risk: Destructive Migration Tokens

Stage 9D already established that migration files contain destructive token findings that require human review. This includes tokens such as:

- `DROP`
- `TRUNCATE`
- destructive `ALTER`

The Stage 9D rehearsal result makes those findings reviewable. It does not authorize real execution.

Before any future staging migration:

1. separate user authorization is required
2. backup readiness must be complete
3. restore rehearsal readiness must be complete
4. rollback owner and stop/go owner must be named
5. production, 3106, and shared long-lived targets must stay out of scope

## Go / No-Go Checklist

Go only if all of the following are true:

- [ ] Stage 9E-0 document is reviewed
- [ ] target identity fields are complete in the approved operator channel
- [ ] target is confirmed not production and not 3106
- [ ] backup manifest format is agreed
- [ ] checksum plan is agreed
- [ ] restore target plan is agreed
- [ ] rollback owner is named
- [ ] decision owner is named
- [ ] next stage authorization text is approved

No-go if any of the following are true:

- [ ] target identity is incomplete or ambiguous
- [ ] target could be production, 3106, or another shared long-lived database
- [ ] backup output path is not approved
- [ ] restore target is not disposable
- [ ] rollback owner is not available
- [ ] any command would require a real database connection in Stage 9E-0
- [ ] any action would read real `data/uploads`
- [ ] any action would call NewAPI, a provider, or a generation path

## Stop Conditions

Stop immediately if any of the following conditions are true:

- database identity does not exactly match the approved target description
- operator cannot prove whether the target is disposable and restorable
- backup storage path is unclear or shared with production artifacts
- `pg_restore --list` cannot be required before restore execution
- rollback owner or decision owner is missing
- a proposed step would touch 3106
- a proposed step would connect to production
- a proposed step would write to any shared staging database without separate authorization
- a proposed step would read or import real `data/uploads`
- a proposed step would change a database feature flag
- a secret, token, database URL, cookie, or Authorization header would appear in logs or Git

## Ownership

The following roles must be named before Stage 9E-1 or later stages:

- stop/go decision owner = `<decision-owner-placeholder>`
- rollback owner = `<rollback-owner-placeholder>`
- backup operator = `<backup-operator-placeholder>`
- restore operator = `<restore-operator-placeholder>`
- evidence reviewer = `<evidence-reviewer-placeholder>`

Do not start a later stage if any role is still unnamed.

## Required Evidence Before Stage 9E-1

Stage 9E-1 is the future read-only staging database identity preflight. Before it can be separately authorized, the following evidence must exist:

- approved Stage 9E-0 plan document
- named target environment label
- named target database identity placeholders
- written confirmation that the target is not production and not 3106
- written confirmation that Stage 9E-1 is read-only only
- written confirmation that no migration, write, import, feature flag cutover, NewAPI call, provider call, or generation path is included
- named operator, decision owner, and rollback owner

## Required Evidence Before Any Staging Migration

Before any future staging migration is separately authorized, the following evidence must exist:

- Stage 9E-1 evidence is complete
- Stage 9E-2 backup and restore verification evidence is complete
- fresh backup artifact exists outside Git
- checksum files exist for the backup artifact
- `pg_restore --list` output is captured and reviewed
- restore rehearsal succeeded against an explicitly disposable target
- rollback checklist is approved
- stop conditions are acknowledged in writing
- migration target is confirmed not production and not 3106
- explicit user authorization names the exact stage and allowed write scope

## Explicit Authorization Templates

The following text is a template only. Do not treat it as standing approval.

### Stage 9E-1 Authorization Template

```text
I authorize Stage 9E-1 only.
Allowed scope: read-only staging database identity preflight against <target-identity-placeholder>.
Not allowed: migration, database write, import, restore execution, real data/uploads read, feature flag change, 3106 action, NewAPI call, provider call, generation, or cost.
Stop if the target identity is ambiguous or permissions exceed the approved read-only scope.
Decision owner: <decision-owner-placeholder>.
Rollback owner: <rollback-owner-placeholder>.
```

### Stage 9E-2 Authorization Template

```text
I authorize Stage 9E-2 only.
Allowed scope: backup creation and restore verification against <disposable-restore-target-placeholder>.
Not allowed: shared staging database write outside the approved backup flow, production access, 3106 action, real data/uploads import, feature flag change, NewAPI call, provider call, generation, or cost.
Stop if backup manifest, checksum files, or restore target identity are incomplete.
Decision owner: <decision-owner-placeholder>.
Rollback owner: <rollback-owner-placeholder>.
```

### Stage 9E-3 Authorization Template

```text
I authorize Stage 9E-3 only.
Allowed scope: staging migration rehearsal against <approved-staging-target-placeholder> with the exact write scope stated in the authorization note.
Not allowed: production access, 3106 action, real data/uploads import, feature flag cutover, NewAPI call, provider call, generation, or any out-of-scope write.
Stop if backup evidence, restore evidence, migration identity, or rollback ownership is incomplete.
Decision owner: <decision-owner-placeholder>.
Rollback owner: <rollback-owner-placeholder>.
```

## Promotion Rule

Stage 9E-0 passing means the identity, backup, and restore rehearsal plan is documented for review. It does not authorize database connection, backup execution, restore execution, migration, import, or Stage 9E-1.
