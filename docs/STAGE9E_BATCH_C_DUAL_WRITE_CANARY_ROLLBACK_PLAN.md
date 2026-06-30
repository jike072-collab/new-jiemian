> Historical planning snapshot. This file records earlier 3107 database planning and does not describe the current 3106 server deployment.

# Stage 9E Batch C Dual-Write Canary Rollback Plan

Stage 9E Batch C is planning only. It prepares authorization boundaries for dual-write shadow mode, read-path canary planning, and rollback rehearsal planning.

This document does not enable dual-write, does not switch any read path, does not change feature flags, does not call NewAPI or a real provider, does not trigger generation, and does not incur cost.

## Hard Boundary

Batch C is not a production cutover and is not a 3106 cutover.

The following boundaries apply to the whole batch:

- no 3106 operation, restart, publish, upgrade, rollback, or stop
- no production database connection
- no production database write
- no production migration
- no staging database write
- no feature flag change
- no dual-write enablement
- no read-path switch to DB
- no NewAPI call
- no real provider call
- no generation trigger
- no cost-incurring action
- no real `data/uploads` read, import, move, delete, or modification
- no repair, cleanup, or deletion of app records
- no production or 3106 cutover

Every command in this document is a placeholder. Replace placeholders only in an approved operator channel after separate authorization for that exact sub-stage. Do not commit real secrets, passwords, tokens, full DSNs, real hostnames, or production labels to Git.

## Current Preconditions

Before any Batch C sub-stage is authorized, re-confirm:

- [ ] worktree is `<local-3107-worktree>`
- [ ] current branch is the approved execution branch or `main` as specified by the authorization
- [ ] `main` and `origin/main` are aligned with the latest approved commit
- [ ] worktree is clean
- [ ] 3107 runtime commit matches the approved workspace commit
- [ ] 3107 health is normal
- [ ] 3106 remains untouched
- [ ] Stage 9E Batch B evidence is accepted
- [ ] DB/files consistency evidence is available
- [ ] stop/go owner and rollback owner are named

## Batch C Scope

Batch C candidate sub-stages:

1. Stage 9E-6: dual-write shadow mode planning
2. Stage 9E-7: 3107 small-scope dual-write shadow enable planning
3. Stage 9E-8: read-path canary planning
4. Stage 9E-9: 3107 read-path canary enable planning
5. Stage 9E-10: rollback rehearsal planning

Batch C planning does not itself authorize implementation, production work, or 3106 work.

## Execution Sequence Recommendation

Run the sub-stages in this order, with separate authorization for each:

1. Stage 9E-6 dual-write shadow mode plan
2. Stage 9E-7 dual-write shadow enable plan
3. Stage 9E-8 read-path canary plan
4. Stage 9E-9 read-path canary enable plan
5. Stage 9E-10 rollback rehearsal plan
6. Batch C final gate report and monitor review

Do not skip the prior planning stage before any enablement planning.

## Actions Requiring Separate Authorization

The following actions must never be treated as implicitly approved:

- enable dual-write
- switch read path to DB
- change feature flags
- connect to production DB
- connect to staging DB with write-capable intent
- run staging migration
- run production migration
- write staging DB business data
- write production DB
- call NewAPI
- call a real provider
- trigger generation
- read real `data/uploads`
- import real uploads
- move, delete, repair, or modify uploads
- repair, cleanup, or delete DB records
- touch 3106
- create or execute any production/3106 cutover
- incur cost

## Stage 9E-6: Dual-Write Shadow Mode Planning

### Goal

Define what a future dual-write shadow mode would need to prove before any enablement is considered.

### Allowed After Separate Authorization

- read-only review of repo and current staging/main status
- define candidate dual-write paths
- define parity metrics and stop conditions
- define rollback expectations
- define required approval owners

### Forbidden

- enabling dual-write
- changing feature flags
- database writes
- production DB connection
- 3106 action
- NewAPI/provider/generation/cost

### Separate Authorization Must Name

- exact dual-write flag names
- target scope
- allowed routes or APIs
- stop/go owner
- rollback owner

### Involvement Matrix

- staging DB read: possible, only if separately authorized for evidence gathering
- staging DB write: no
- real uploads read: no
- NewAPI/provider/generation: no
- possible cost: no
- 3106 involved: no

### Planning Checklist

- [ ] dual-write paths enumerated
- [ ] current feature flags confirmed default-off
- [ ] parity metrics enumerated
- [ ] alert thresholds enumerated
- [ ] rollback switch identified
- [ ] evidence owner named

### Placeholder Commands

Do not execute without separate authorization.

```powershell
node scripts/database/check-library-db-file-consistency.mjs `
  --mode "read-only" `
  --no-repair `
  --output "<CONSISTENCY_EVIDENCE_PLACEHOLDER>"
```

### Stop Conditions

Stop immediately if:

- any enablement is implied
- any DB write is implied
- any provider call is implied
- any 3106 dependency appears
- any production target is implied

### Evidence Checklist

- [ ] dual-write path list
- [ ] feature flag list
- [ ] parity metrics
- [ ] rollback strategy
- [ ] owner list

## Stage 9E-7: Dual-Write Shadow Enable Planning

### Goal

Define a narrow 3107-only enablement plan for dual-write shadow mode.

### Allowed After Separate Authorization

- read-only review of current staging guard state
- define 3107-only enablement window
- define expected parity checks
- define health and latency observations

### Forbidden

- enabling without separate authorization
- production DB
- 3106
- feature flags beyond approved ones
- provider/NewAPI/generation/cost

### Separate Authorization Must Name

- exact flag names
- 3107-only scope
- observation window
- stop/go owner
- rollback owner

### Planning Checklist

- [ ] 3107-only scope
- [ ] default-off confirmed
- [ ] no production / no 3106
- [ ] no real generation
- [ ] no cost
- [ ] rollback step identified

### Stop Conditions

Stop immediately if:

- any production pointer appears
- any 3106 pointer appears
- any provider call appears
- parity mismatch is expected or unbounded
- rollback step is undefined

### Evidence Checklist

- [ ] flag name
- [ ] target scope
- [ ] parity metrics
- [ ] rollback path
- [ ] owners

## Stage 9E-8: Read-Path Canary Planning

### Goal

Define a read-path canary plan that stays read-only and does not switch the live application to DB reads.

### Allowed After Separate Authorization

- read-only comparison plan
- define candidate routes
- define shadow comparison methods
- define error and latency thresholds

### Forbidden

- switching read path to DB
- enabling dual-write
- feature flag changes without separate authorization
- production DB
- 3106
- provider/NewAPI/generation/cost

### Separate Authorization Must Name

- canary routes
- comparison method
- observation window
- stop/go owner
- rollback owner

### Planning Checklist

- [ ] JSON/existing vs DB comparison method
- [ ] allowed routes
- [ ] forbidden routes
- [ ] rollback step
- [ ] ownership

### Stop Conditions

Stop immediately if:

- any full cutover is implied
- any DB write is implied
- any production or 3106 target appears
- any provider call is implied

### Evidence Checklist

- [ ] route list
- [ ] comparison method
- [ ] thresholds
- [ ] rollback plan
- [ ] owner list

## Stage 9E-9: 3107 Read-Path Canary Enable Planning

### Goal

Define the smallest possible 3107-only enablement window for read-path canary evaluation.

### Allowed After Separate Authorization

- 3107-only enablement plan
- read-only observation plan
- health verification plan
- rollback switch plan

### Forbidden

- production
- 3106
- full cutover
- dual-write enablement
- provider/NewAPI/generation/cost

### Separate Authorization Must Name

- 3107-only scope
- feature flag name
- observation window
- stop/go owner
- rollback owner

### Planning Checklist

- [ ] 3107-only scope
- [ ] no production
- [ ] no 3106
- [ ] no generation
- [ ] no cost
- [ ] rollback step

### Stop Conditions

Stop immediately if:

- scope expands beyond 3107
- any production or 3106 signal appears
- any provider call appears
- health regresses

### Evidence Checklist

- [ ] flag name
- [ ] scope
- [ ] health checks
- [ ] parity checks
- [ ] rollback step

## Stage 9E-10: Rollback Rehearsal Planning

### Goal

Define a rollback rehearsal plan that stays planning-only until separately authorized.

### Allowed After Separate Authorization

- define staging/test target identity
- define backup artifact expectations
- define manifest and checksum requirements
- define restore verification requirements
- define app config rollback and feature flag rollback expectations

### Forbidden

- executing rollback
- production or 3106 target
- real uploads modification
- provider/NewAPI/generation/cost

### Separate Authorization Must Name

- backup artifact owner
- restore operator
- decision owner
- rollback owner
- allowed target identity

### Planning Checklist

- [ ] backup artifact requirements
- [ ] checksum requirements
- [ ] restore verification
- [ ] rollback switch
- [ ] owners

### Stop Conditions

Stop immediately if:

- target is ambiguous
- production or 3106 is implicated
- restore would touch shared data
- any provider call is implied

### Evidence Checklist

- [ ] target identity
- [ ] artifact expectations
- [ ] checksum expectations
- [ ] restore checks
- [ ] owner list

## Batch C Final Output

The final Batch C report must include:

```text
Batch C status: PASS / PARTIAL / BLOCKED

Planning artifacts:
- dual-write plan:
- read-path canary plan:
- rollback rehearsal plan:

Safety:
- production DB touched: no
- 3106 touched: no
- staging DB written: no
- uploads modified: no
- NewAPI/provider called: no
- generation triggered: no
- cost incurred: no

Recommendation:
- enter Batch C implementation: yes/no
- required separate authorization:
```

## Draft PR Description Template

```markdown
## Summary

- Add Stage 9E Batch C dual-write canary rollback plan
- Define dual-write shadow mode planning gates
- Define read-path canary planning gates
- Define rollback rehearsal planning gates

## Safety

- planning only
- no dual-write enabled
- no read-path canary enabled
- no rollback executed
- no DB business write
- no real generation
- no NewAPI/provider
- no cost
- no production DB
- no 3106
- Batch C implementation requires separate authorization

## Checks

- npm run lint
- npm run typecheck
- npm run check
- git diff --check
```

