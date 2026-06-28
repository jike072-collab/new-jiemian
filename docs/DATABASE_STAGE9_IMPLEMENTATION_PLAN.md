# Database Stage 9 Implementation Plan

Stage 9A produces audit and design artifacts only. It does not authorize schema
changes, migrations, production writes, payment integration, live provider
probing, or real generation smoke tests.

## Recommended Next Stage

Stage 9B should be a read-only implementation-prep stage:

- verify current PostgreSQL schema metadata on staging only
- add schema drift checks if missing
- refine library/assets migration acceptance criteria
- add tests for future scripts without touching production
- keep 3106 unchanged

Do not move production library data in Stage 9B unless the user explicitly
authorizes a schema/data migration stage.

## Stage 9B Scope

Allowed:

- read-only schema metadata checks
- additional docs
- test-only scripts that use temp directories or test databases
- CI checks for server-only database boundaries
- no-op migration dry-run checks

Forbidden:

- production schema changes
- production migrations
- production data writes
- NewAPI calls
- generation provider calls
- live `/models`
- payment calls
- 3106 publish/restart

Acceptance:

- docs/scripts pass CI
- 3106 and 3107 snapshots unchanged
- no secrets in output
- no generation/NewAPI/live `/models`

## Stage 9C Scope

Stage 9C can implement the first database-backed slice only after separate
authorization. Recommended first slice:

1. add library/assets schema to a migration file
2. add repository interfaces
3. add test-only migration checks
4. keep production runtime on JSON until staging validation passes

Production cutover should be separate from schema introduction.

Acceptance:

- migration applies on an isolated test database
- repository tests pass
- JSON and DB counts can be compared without reading row contents
- rollback plan exists
- no production write occurs until a later release approval

## Deferred Features

Defer these until after library/assets and job history are stable:

- real payment provider
- quota ledger production charging
- full prompt retention
- raw provider response archival
- object storage migration
- hard-delete purge automation
- live provider `/models` scheduled sync
- real generation smoke tests
- network/firewall/HTTPS apply work

## Stage 9D Scope

Stage 9D is a rehearsal-only stage:

- add migration rehearsal against a throwaway database only
- add import dry-run against fixture or copied test data only
- add DB/file consistency checks
- add rollback readiness and release gate documentation
- keep 3106 unchanged
- keep feature flags default-off
- do not run a real production migration
- do not run a real staging migration
- do not import real data/uploads
- do not call NewAPI or real providers

Passing Stage 9D means the release plan is reviewable. It does not authorize a real cutover.

## Phase Acceptance Matrix

| Phase | Schema Change | Migration | 3106 Publish | External Calls | Goal |
| --- | --- | --- | --- | --- | --- |
| 9A | no | no | no | no | audit and design |
| 9B | no by default | no | no | no | implementation prep |
| 9C | staging/test only unless approved | test/staging only | no by default | no | first DB-backed slice |
| 9D | no new production schema by default | rehearsal only on isolated test DB | no | no | migration rehearsal, dry-run, rollback readiness |
| 9E | only with separate authorization | only with separate authorization | only with separate authorization | only with separate authorization | controlled production cutover |

## When Schema Changes Are Allowed

Schema changes are allowed only when:

- the user explicitly authorizes the stage
- migration file is reviewed
- backup and rollback plan exist
- staging validation passes
- CI is green
- 3106 release decision is separate and explicit

Stage 9D does not satisfy those production conditions by itself.

## When 3106 Publish Is Forbidden

3106 publish is forbidden during:

- audit-only stages
- docs-only stages
- failed CI
- failed 3107 validation
- missing backup
- expired rollback authorization when rollback capability is required
- unexplained data/uploads checksum drift
- any observed NewAPI/generation/live `/models` call in a no-call stage
- Stage 9D has not been superseded by a fresh Stage 9E preflight

## Live Provider `/models`

Live provider `/models` requires separate authorization because it can make
external provider requests. It should be a bounded read-only probe:

- specific provider list
- no generation payloads
- no API key output
- no raw provider response output
- timeout and retry limits
- log redaction
- rollback/stop conditions

## Real Generation Smoke

Real generation smoke requires separate explicit authorization because it can
consume quota or money. Before it runs:

- define provider/model
- define prompt/test asset
- define maximum count
- define maximum budget
- back up data/uploads/database
- record expected writes
- record stop conditions

## Network, HTTPS, Firewall

Network apply work waits for server and domain readiness. It should be handled
as a separate stage with:

- listener snapshot
- firewall snapshot
- PostgreSQL/NewAPI bind plan
- reverse proxy config review
- rollback plan
- no overlap with schema migration or payment rollout

## Minimum Stage 9B Checklist

- current branch from main
- no production writes
- no migration apply
- no generation/NewAPI/live `/models`
- run database doc checks
- run runtime isolation checks
- run log redaction checks
- confirm 3106 PID/commit unchanged
- confirm data/uploads unchanged
- open draft PR only
