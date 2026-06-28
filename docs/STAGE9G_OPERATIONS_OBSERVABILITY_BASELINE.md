# Stage 9G-1 Operations And Observability Baseline

Stage 9G-1 is a documentation and low-risk verification baseline for 3107 operations and observability readiness.

This document does not connect external monitoring SaaS, does not change production config, does not touch 3106, does not call NewAPI or a real provider, does not trigger generation, does not incur cost, and does not write business data.

## Hard Boundary

The following rules apply to this baseline:

- no 3106 operation, restart, deploy, upgrade, or rollback
- no production DB access
- no production config change
- no provider or NewAPI real call
- no generation trigger
- no cost-incurring action
- no business DB write
- no migration
- no external observability SaaS integration

This stage is allowed to document current commands, current signals, current log rules, and current incident response steps already supported by the repo.

## Goal

Define the minimum operational baseline that must exist before later rollout work widens:

- how 3107 health is checked
- what signals are already available
- what logs must and must not contain
- what incident runbooks exist at minimum
- what remains intentionally manual or deferred

## 3107 Health Baseline

Current repo-supported 3107 health baseline is built from existing scripts and safe routes.

### Canonical Commands

Status:

```powershell
npm run service:status -- staging
```

Health:

```powershell
npm run service:health -- staging
```

Watchdog:

```powershell
npm run service:watchdog:staging
```

### Required 3107 Baseline Checks

The minimum healthy 3107 baseline should show:

- backend health endpoint reachable
- home page reachable
- login page reachable
- library endpoint reachable under the current authorized route contract
- service health command returns `ok=true`
- watchdog status is healthy, deferred for an active operation, or otherwise non-destructive
- `newApiCalled=false`

### Route And Status Baseline

Current health and audit scripts already probe the following safe surfaces:

- `/`
- `/login`
- `/api/library`
- `/api/health/backend`
- `/admin/providers`

Current status and health outputs already expose or imply:

- `service`
- `listening`
- `pid`
- `port`
- `root`
- `runtimeRoot`
- `activeRelease`
- `commit`
- `workspaceCommit`
- `runtimeCommit`
- `commitsMatch`
- `identityStatus`
- `identityReason`
- `startedAt`
- `dataDir`
- `uploadsDir`
- `home`
- `healthStatus`
- `healthOk`
- `newApiCalled=false`

### Minimum Operator Readout

Before any later rollout step, capture this non-sensitive snapshot:

- current branch
- workspace commit
- runtime commit
- `commitsMatch`
- listening port
- service root
- runtime root
- home status
- backend health status
- library status
- admin-providers status
- `newApiCalled=false`

## Minimum Observation Signals

This repo already provides enough local signals to define a minimum observation baseline even without external monitoring.

### Request Error Rate

Minimum baseline:

- detect repeated non-200 backend health results
- detect route status drift on `/`, `/login`, `/api/library`, `/admin/providers`

Current evidence:

- `scripts/ops/health-check.mjs`
- `scripts/audit-production-readiness.mjs`

### Latency

Minimum baseline:

- watch for repeated health-check failures or timeouts
- record whether route probes return `0` or non-success status

Current limitation:

- the repo does not yet expose a first-class latency time-series metric
- current baseline is probe-result oriented, not metrics-platform oriented

### Login Failures

Minimum baseline:

- watch auth error spikes
- distinguish rate limit and credential failures
- preserve safe audit visibility without leaking credentials

Current evidence:

- auth service rate limiting exists for login and registration
- auth service records audit events with hashed IP and user-agent summaries

### Generation Validation Rejects

Minimum baseline:

- count or at least classify invalid input rejects before provider dispatch
- preserve safe user-facing and internal diagnostic separation

Current evidence:

- validation and diagnostics already exist in auth/admin/server-side logic
- Stage 9F confirms generation-parameter guarding still needs dedicated follow-up work

### Provider Call Detection

Minimum baseline:

- detect whether a supposedly safe health or audit path accidentally touched provider-facing routes
- detect provider-related errors in logs

Current evidence:

- `forbiddenRequestPatterns` already treat generation/upscale/provider-related routes as forbidden in safe audit paths
- provider-related log findings already map to a `provider` suspicious pattern

### NewAPI Call Detection

Minimum baseline:

- safe health and audit scripts must continue to report `newApiCalled=false`

Current evidence:

- `scripts/ops/health-check.mjs`
- `scripts/check-studio-api-contracts.mjs`
- `scripts/test-stage3-studio-regression.mjs`
- `scripts/test-network-hardening-dry-run.mjs`
- `scripts/audit-database-current-state.mjs`

### Billing Failure And Refund Events

Minimum baseline:

- preserve visibility into billing order failures, replay handling, refund paths, and reconciliation-required states

Current evidence:

- billing service tests already cover idempotency, replay, review, refund, and recovery paths
- task billing tests already cover dispatch claim, refund-once, and reconciliation-required paths

### Disk Usage

Minimum baseline:

- monitor runtime data and uploads growth before later rollout work widens

Current current-state note:

- the repo has directory snapshots and backup manifests
- the repo does not yet expose a first-class disk-usage metric stream
- treat this as a documented manual observation item, not a solved observability surface

### Uploads Directory Size

Minimum baseline:

- record whether uploads inventory or snapshot size changes unexpectedly

Current evidence:

- snapshot and manifest utilities already exist
- current audits can report counts, sizes, and checksums when runtime snapshots are explicitly enabled

### DB Connection Errors

Minimum baseline:

- detect staging DB or local DB availability problems from logs without leaking DSNs or credentials

Current evidence:

- suspicious log finding `databaseError`
- redaction blocks DSN, password, token, and secret leakage

### Task Queue Backlog

Minimum baseline:

- document as future-facing only

Current note:

- the repo has task and billing state machines
- it does not yet have a durable queue platform with first-class backlog metrics
- backlog observation remains a future `9G-4` follow-up item

## Logging Requirements

### Must Redact

Logs and status output must never expose:

- full DSN
- API key
- token
- cookie
- session value
- password
- raw secret
- raw provider payload containing sensitive content
- multiline shell output that includes secrets

### Current Redaction Rules

Current repo logic already redacts or suppresses:

- `Authorization`
- `Cookie`
- `Set-Cookie`
- token / password / secret / API-key style fields
- PostgreSQL URLs and DSNs
- JWT-like tokens
- large base64 payloads
- large data URLs
- NewAPI raw log output through the redaction path

### Logging Rules To Keep

- summaries may say `configured`, `missing`, or `masked`
- summaries must not print real secret values
- logs must remain useful for diagnostics after redaction
- current redaction tests must stay green

## Incident Runbook Baseline

### 1. 3107 Health Regression

Minimum response:

1. run `npm run service:status -- staging`
2. run `npm run service:health -- staging`
3. inspect watchdog outcome with `npm run service:watchdog:staging`
4. inspect masked log findings
5. stop if identity is foreign or ambiguous
6. do not touch 3106 without separate authorization

### 2. Unexpected Provider Call Signal

Minimum response:

1. stop any non-essential verification work
2. confirm whether the request came from a safe script regression or a route regression
3. inspect forbidden-request findings and provider-pattern log findings
4. keep `newApiCalled=false` evidence with the report
5. do not retry with real generation

### 3. Cost Signal Detected

Minimum response:

1. treat as a release blocker
2. stop rollout expansion
3. inspect whether a provider path or billing path was accidentally widened
4. do not continue until the call path is identified

### 4. DB Permission Error

Minimum response:

1. capture the non-sensitive DB identity and role summary if already authorized
2. inspect masked database-error log findings
3. confirm whether the failure is read-only, migration-related, or application-write related
4. do not widen DB privileges implicitly

### 5. Uploads Access Denied Spike

Minimum response:

1. verify path and ownership guard expectations
2. confirm whether the failures are legitimate rejects or route regressions
3. do not bypass the guard with temporary broadening

### 6. Disk Usage High

Minimum response:

1. capture directory snapshot evidence
2. check whether runtime artifacts, logs, backups, or uploads are driving growth
3. do not delete data or uploads without separate authorization

### 7. Login Abuse

Minimum response:

1. confirm login rate limiting is still active
2. review auth audit evidence
3. document whether a tighter local limit is needed in `9G-2`

### 8. Billing Mismatch

Minimum response:

1. inspect billing and task-billing audit signals
2. confirm whether the mismatch is replay, refund, or reconciliation-related
3. stop before any manual repair without separate authorization

## No-Provider-Call And Low-Risk Verification Baseline

The repo already has a meaningful low-risk verification pattern.

Current useful checks include:

- `npm run service:health`
- `npm run test:ops`
- `npm run test:log-redaction`
- `npm run test:stage3-studio-regression -- --skip-runtime`
- `npm run test:stage4-provider-health`
- `npm run test:provider-health`
- `npm run test:network-hardening-dry-run`

What this baseline can safely claim:

- safe health checks do not use generation endpoints
- safe checks continue to report `newApiCalled=false`
- provider-health checks remain read-only by default
- masked logs remain enforced

## Explicitly Forbidden Without Separate Authorization

The following remain outside this baseline:

- any 3106 operation
- any production DB connection
- any production migration
- any provider or NewAPI real call
- any cost-incurring test
- any business-data write
- any rollback execution
- any feature-flag change

## Evidence Sources

Primary repo evidence:

- `package.json`
- `scripts/ops/service-status.mjs`
- `scripts/ops/health-check.mjs`
- `scripts/ops/watchdog-service.mjs`
- `scripts/audit-production-readiness.mjs`
- `scripts/audit-database-current-state.mjs`
- `scripts/test-ops-service.mjs`
- `scripts/test-log-redaction.mjs`
- `docs/PRODUCTION_OPERATIONS.md`
- `docs/PRODUCTION_READINESS_AUDIT.md`
- `docs/PROVIDER_HEALTH_CHECKS.md`
- `docs/STUDIO_REGRESSION_GUARDS.md`

## Outcome

Stage 9G-1 defines a minimum local operations and observability baseline that is already mostly supported by the current repo.

Main current gap:

- disk-usage and uploads-growth observation are documented but not yet elevated to a first-class live metric surface

That gap does not block this documentation baseline, but it should not be overstated as already solved.
