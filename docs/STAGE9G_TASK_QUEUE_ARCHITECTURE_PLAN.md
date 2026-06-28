# Stage 9G-4 Task Queue Architecture Plan

Stage 9G-4 is a planning-only architecture document for long-running generation and settlement work.

This stage does not introduce BullMQ, does not introduce Redis, does not change the current dispatch path, does not call a provider, does not trigger generation, does not migrate schema, does not write DB state, and does not touch 3106.

## Hard Boundary

The following are not authorized by this plan:

- no BullMQ
- no Redis
- no new queue dependency
- no provider call
- no NewAPI call
- no generation trigger
- no dispatch-path change
- no migration
- no DB write
- no production config change
- no 3106 operation

This document may describe current behavior, current risks, and future target architecture only.

## Current Task Lifecycle Summary

The current repo already has pieces of a task lifecycle, but they are split across library storage, provider dispatch, job polling, and task-billing state.

### Current Observed Lifecycle

1. request arrives at generation route
2. auth and CSRF are checked
3. request payload is normalized and validated
4. quota/task billing precheck can reserve or confirm budget intent
5. provider dispatch is attempted
6. library/job records are created or updated
7. provider returns:
   - immediate success payload
   - queued/async task id
   - failure
8. polling or follow-up refresh updates job status
9. task billing settles, fails, refunds, or enters reconciliation-required state

### Current Status Vocabulary

Current generation and billing state vocabulary already includes:

- generation jobs:
  - `queued`
  - `running`
  - `succeeded`
  - `failed`
  - `canceled`
- current JSON-facing job states:
  - `queued`
  - `generating`
  - `done`
  - `failed`
- task billing:
  - `prechecked`
  - `accepted`
  - `dispatching`
  - `provider_started`
  - `provider_succeeded`
  - `provider_failed`
  - `settled`
  - `failed`
  - `cancelled`
  - `refunded`
  - `reconciliation_required`

### Current Billing Alignment

The current task-billing service already tries to align:

- quota precheck
- dispatch claim
- provider-start transition
- provider-success transition
- provider-failure transition
- refund-once behavior
- reconciliation-required fallback

This is useful groundwork, but it is not yet a full queue system.

## Current Risks

### 1. No Durable Queue

Current risk:

- request path and provider dispatch are still tightly coupled
- recovery depends on current process behavior and repository logic, not on a dedicated durable worker queue

### 2. Concurrency

Current risk:

- there is no dedicated global worker concurrency layer for generation jobs
- current repo has several local serialized repositories and task locks, but not an explicit queue-wide concurrency controller

### 3. Retry Policy

Current risk:

- retry behavior is distributed across task-billing and provider-specific paths
- there is no single retry policy contract for queued generation work

### 4. Timeout Policy

Current risk:

- there are timeout values in individual services
- there is no unified long-running job timeout policy across all generation surfaces

### 5. Duplicate Dispatch

Current risk:

- duplicate submits, browser refreshes, callback replay, or partial failures can attempt to re-enter the same task lifecycle
- current code already uses idempotency in billing/task layers, but generation dispatch itself is not yet behind a dedicated queue envelope

### 6. Idempotency Fragmentation

Current risk:

- idempotency exists in multiple subsystems
- there is not yet one single job-envelope idempotency contract spanning request, provider dispatch, result write, and settlement

### 7. Cost Spike Risk

Current risk:

- if dispatch retries or duplicate provider submits escape current guardrails, cost-bearing calls could multiply
- current repo mitigates some of this through task-billing states and no-provider-call safe checks, but not through a true worker queue

## Current Evidence In Repo

The repo already provides useful raw material:

- generation routes are explicit
- provider dispatch logic lives in server modules
- generation job DB schema exists
- task billing lifecycle and idempotency schema exist
- reconciliation and refund behavior already have tests
- provider health checks remain read-only by default

Important current-state note:

- Stage 9F and Stage 9G still prioritize security, observability, and planning over queue-stack replacement
- current runtime remains on safe defaults, not on a DB-read-path or Batch C implementation path

## Target Architecture

The future target should separate submission from execution more clearly.

### Queue

Future queue responsibilities:

- accept a normalized job envelope
- persist queue state durably
- guarantee one stable job id
- preserve idempotency key
- separate submit from execute

### Worker

Future worker responsibilities:

- claim ready jobs
- enforce concurrency limit
- dispatch provider call
- update lifecycle state
- write safe result metadata
- trigger settlement or compensation path

### Concurrency

Minimum future requirements:

- explicit per-worker concurrency
- explicit per-user concurrency cap where appropriate
- explicit provider or model concurrency cap where appropriate

### Retry Policy

Minimum future requirements:

- classify retryable vs non-retryable failures
- bounded retry count
- backoff strategy
- audit of retry exhaustion

### Timeout Policy

Minimum future requirements:

- submission timeout
- provider request timeout
- poll timeout
- total job lifetime timeout
- stale-running detection

### Dead-Letter Queue

Minimum future requirements:

- jobs that exhaust retries or violate invariants should move to a DLQ or equivalent review-required state
- support operator review without auto-replaying unsafe work

### Idempotency Key

Minimum future requirements:

- one end-to-end idempotency key
- same key reused for:
  - submit
  - dispatch claim
  - settlement
  - replay detection

### Status Machine

Target state machine should make these phases explicit:

- accepted
- queued
- claimed
- dispatching
- provider_running
- provider_succeeded
- provider_failed_retryable
- provider_failed_final
- settling
- settled
- refunded
- reconciliation_required
- dead_lettered

### Billing Lifecycle Alignment

Future queue architecture must stay aligned with:

- quota precheck before dispatch
- no duplicate cost on replay
- refund-once semantics
- reconciliation-required fallback on partial failure
- no provider retry that bypasses billing invariants

## BullMQ Evaluation

### Potential Advantages

- durable queue semantics
- worker concurrency controls
- retries and backoff
- delayed jobs
- stalled-job handling
- operationally familiar model for async workloads

### Redis Operations Cost

Cost and burden that must be evaluated before adoption:

- Redis deployment and persistence
- backup and restore policy
- monitoring
- worker lifecycle management
- credential and network hardening
- failure handling during Redis unavailability

### Failure Modes

BullMQ or any queue stack still needs clear policy for:

- duplicate claim
- partial provider success with missing local write
- local write success with settlement failure
- worker crash between dispatch and settlement
- delayed callback or polling mismatch

### Migration Path

If adopted later, migration should be incremental:

1. define job envelope and state contract without changing provider routes
2. shadow-write queue metadata if separately authorized
3. move one narrow async path first
4. prove no duplicate dispatch and no billing drift
5. expand only after evidence passes

### P1 Suitability

BullMQ can be a future P1 candidate only if:

- local short-term controls are no longer enough
- Redis ops cost is accepted
- queue durability is a clearer bottleneck than the current security/stability backlog

## Short-Term No-New-Dependency Plan

Before any queue dependency is introduced, the repo can still improve locally.

### Local Concurrency Cap

Potential short-term step:

- add explicit in-process concurrency caps for the most cost-sensitive dispatch paths

### Dispatch Lock

Potential short-term step:

- standardize one dispatch claim lock per job/task id
- align it with task-billing accepted/dispatching transitions

### Timeout Guard

Potential short-term step:

- document and centralize current provider dispatch timeout, poll timeout, and stale-dispatch thresholds

### No-Provider-Call Tests

Potential short-term step:

- keep extending safe tests that prove planning, health, and provider-health paths never dispatch generation work

### Health Metrics

Potential short-term step:

- document queue-like counters even before a real queue exists:
  - pending jobs
  - running jobs
  - failed jobs
  - reconciliation-required jobs
  - timed-out jobs

## Recommended Phased PR Plan

Recommended future order:

1. complete `9F-2 ownership guard`
2. complete `9F-3 generation parameter guard`
3. complete `9G-1 operations observability baseline`
4. add local generation guardrails and timeout instrumentation
5. define normalized job-envelope contract in docs/tests
6. evaluate queue dependency only after real evidence shows it is needed

If queue work is later approved, keep it split:

1. PR 1: planning and contracts only
2. PR 2: local short-term guardrails with no new dependency
3. PR 3: optional queue substrate proposal
4. PR 4: one narrow async path migration

## Items Requiring Separate Authorization

Separate user authorization is required for:

- BullMQ
- Redis
- any new dependency
- any dispatch-path change
- any DB migration
- any DB write
- any provider call
- any real generation test
- any production config change
- any 3106 operation

## Evidence Sources

Primary repo evidence:

- `src/lib/server/provider-call.ts`
- `src/lib/server/volcengine-upscale.ts`
- `src/lib/server/quota/task-billing-service.ts`
- `src/lib/server/quota/task-billing-repository.ts`
- `src/lib/server/billing/service.ts`
- `src/lib/server/database/library-jobs-adapter.ts`
- `src/lib/server/database/mvp-repositories.ts`
- `db/migrations/001_initial_application_schema.sql`
- `db/migrations/004_task_billing_lifecycle.sql`
- `db/migrations/005_task_billing_precheck_fingerprint.sql`
- `db/migrations/006_task_billing_dispatch_states.sql`
- `db/migrations/007_database_mvp_foundation.sql`
- `docs/GENERATION_JOBS_DATABASE_BACKEND.md`

## Outcome

Stage 9G-4 records the current long-running job and settlement architecture, the main risks, and the future queue direction.

It does not introduce BullMQ, does not introduce Redis, does not change dispatch behavior, and does not authorize any runtime implementation work.
