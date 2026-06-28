# Stage 9G-2 Rate Limit And Abuse Protection Plan

Stage 9G-2 is a planning-only document for minimum local rate limiting and abuse protection.

This document does not add Arcjet, Redis, external SaaS, production config, migration, business DB writes, provider calls, NewAPI calls, real generation, real load testing, cost-incurring work, or any 3106 operation.

## Hard Boundary

The following are not authorized by this plan:

- no Arcjet or equivalent dependency
- no Redis
- no external monitoring or abuse-protection SaaS
- no production config change
- no real provider call
- no NewAPI call
- no real generation trigger
- no real load test against 3107
- no business DB write
- no migration
- no 3106 operation

The plan may reference current repo helpers, current tests, and future implementation order.

## Current Repo Baseline

Current protective controls already present:

- local in-memory auth rate limiter
- login rate limit default: `5` attempts per `10` minutes
- registration rate limit default: `3` attempts per `1` hour
- prompt optimizer route uses an in-memory limiter
- generation and upscale routes require auth and CSRF before provider-facing logic
- admin API uses `requireAdmin()`
- admin write actions are audited
- auth audit events hash IP and user-agent context
- file path sanitization prevents path traversal for stored names

Current important gaps:

- `/api/files/[name]` path safety exists, but access/ownership guard is still a P0 follow-up lane
- `/api/library` ownership scoping is still a P0 follow-up lane
- generation endpoints need more explicit parameter and cost guard work
- admin mutation rate limiting is not yet a dedicated control
- suspicious repeated file-access failures are not yet a first-class local signal

## 1. Login Anti-Bruteforce

### Target Control

Login abuse protection should combine:

- IP dimension
- account / identifier dimension
- failed login count
- bounded cooldown
- stricter admin-login posture
- redacted audit evidence

### Current Evidence

Current code already has:

- `src/lib/server/auth/rate-limit.ts`
- `src/lib/server/auth/service.ts`
- `AUTH_RATE_LIMITED`
- auth audit events for login failure, login block, and session state

### Recommended Minimum Implementation

First local implementation should stay in-repo:

- keep current `InMemoryRateLimiter`
- keep per-action keying
- include identifier and IP in the limiter key
- record failed login audit events without raw password, token, or cookie
- return a stable `429` response with retry-after seconds
- keep register and login limits separately tunable through existing patterns

### Admin Login Hardening

Admin users should get stricter treatment:

- lower failed-attempt threshold for admin identifiers
- longer cooldown after repeated failure
- audit admin login failures separately if role is knowable without leaking user existence
- avoid disclosing whether the account exists or is admin

### Stop Conditions

Stop implementation if:

- a change requires external abuse-protection SaaS
- a change requires Redis
- a change requires production config
- audit details would store raw password, token, cookie, or full IP address

## 2. Generation Endpoint Abuse Protection

### Target Control

Generation endpoints need guardrails before provider dispatch:

- per-user rate limit
- per-IP rate limit
- cost guard
- validation before provider dispatch
- provider-call hard stop condition
- audit of rejects without sensitive payloads

### Current Evidence

Current code already has:

- authenticated generation routes
- CSRF checks before form parsing/provider dispatch
- no-provider-call regression checks
- quota and task-billing service tests
- Stage 9F recommendation for `9F-3 generation parameter guard`

### Recommended Minimum Implementation

The first code PR should:

- validate inputs before provider lookup and dispatch
- reject unsupported mode/model/parameter combinations before cost-bearing work
- require quota precheck before provider dispatch where applicable
- add per-user and per-IP local rate limits
- produce stable user-facing reject codes
- assert tests show `generationEndpointsCalled=false` for safe checks

### Cost Guard

Minimum cost guard should require:

- known user session
- valid CSRF
- validated model and mode
- bounded file count and file size
- accepted quota precheck
- no provider dispatch if validation or quota fails

### Stop Conditions

Stop immediately if:

- a test path starts calling NewAPI or a provider
- validation cannot run before provider dispatch
- the plan requires real generation to verify
- quota/cost behavior cannot be proven without production credentials

## 3. File Access Anti-Scraping

### Target Control

`/api/files/[name]` should be protected by:

- auth/session guard
- path traversal reject
- cross-user reject
- suspicious repeated 404/403 observation
- no raw file-system path leakage

### Current Evidence

Current code already has:

- `safeStoredName()`
- `resolveUploadPath()`
- `readStoredFile()`
- path containment checks

Current gap:

- the file route currently needs the `9F-2 ownership guard` lane to become formally access-scoped

### Recommended Minimum Implementation

After `9F-2` lands:

- require auth before serving `/api/files/[name]`
- derive current user from session
- resolve stored file only through an owned library item or asset
- fail closed for orphan or legacy ownerless files
- return `404` or `403` without revealing path details
- log suspicious repeated denials with redacted context

### Stop Conditions

Stop if:

- implementation would read or inventory real uploads without explicit authorization
- implementation would delete, move, repair, or modify upload files
- route returns full local file paths

## 4. Admin API Abuse Protection

### Target Control

Admin API protection should include:

- admin-only guard
- mutation-specific rate limit
- CSRF where applicable
- audit log for mutations
- safe error output

### Current Evidence

Current code already has:

- `requireAdmin()`
- admin API wrapper
- admin audit events
- admin tests for anonymous and non-admin denial
- sanitized provider config responses

### Recommended Minimum Implementation

Minimum next step:

- add mutation-specific local rate limit for high-impact admin writes
- keep read-only admin health routes separate from mutation routes
- ensure admin mutation audit records include actor, action, target id, and safe details
- add tests for non-admin denial and admin mutation throttling

### Stop Conditions

Stop if:

- a change broadens admin access
- a mutation route bypasses CSRF or audit
- raw provider secret is returned or logged

## 5. Audit And Observation Signals

Minimum local observation should include:

- `AUTH_RATE_LIMITED` count
- login failure count
- registration rate-limit count
- generation validation reject count
- generation provider-dispatch blocked count
- file 403/404 repeated failure count
- admin mutation deny count
- admin mutation rate-limit count
- provider/NewAPI call detection remains false for safe tests

These can start as tests, logs, and audit records. They do not require a new monitoring platform in this stage.

## 6. Recommended Implementation Order

Recommended order:

1. finish `9F-2 ownership guard` for `/api/library` and `/api/files/[name]`
2. finish `9F-3 generation parameter guard`
3. tighten `9F-1 admin RBAC`
4. add local generation endpoint rate limiting
5. add local admin mutation rate limiting
6. add suspicious file-access denial observation
7. only then evaluate external services

This order keeps the highest-risk data-access gaps ahead of convenience architecture work.

## 7. Future Dependency Evaluation

### Arcjet Or Similar

Potential value:

- bot filtering
- distributed rate limiting
- public abuse protection
- hosted policy and telemetry

Do not introduce until:

- local protection gaps are closed
- public abuse pressure is measured
- production config changes are separately approved
- data handling and privacy implications are reviewed

### Redis

Potential value:

- cross-process rate-limit counters
- queue/backlog state
- delayed job support

Do not introduce until:

- operations owner accepts Redis lifecycle cost
- failure modes are documented
- local in-process controls are proven insufficient

### BullMQ

Potential value:

- durable generation queue
- retries
- delayed jobs
- concurrency controls

Do not introduce in this plan. Evaluate in `9G-4`.

## 8. Items Requiring User Authorization

Separate user authorization is required for:

- new dependency
- Redis
- external SaaS
- production config change
- production DB access
- migration
- real load test
- provider call
- NewAPI call
- real generation
- any 3106 operation

## Evidence Sources

Primary repo evidence:

- `src/lib/server/auth/rate-limit.ts`
- `src/lib/server/auth/service.ts`
- `src/lib/server/auth/http.ts`
- `src/lib/server/auth/csrf.ts`
- `src/lib/server/admin/service.ts`
- `src/lib/server/admin/http.ts`
- `src/lib/server/prompts/http.ts`
- `src/app/api/generate/image/route.ts`
- `src/app/api/generate/video/route.ts`
- `src/app/api/upscale/image/route.ts`
- `src/app/api/upscale/video/route.ts`
- `src/app/api/files/[name]/route.ts`
- `src/lib/server/library.ts`
- `src/lib/server/auth/__tests__/auth-service.test.ts`
- `src/lib/server/admin/__tests__/admin-api-smoke.test.ts`
- `scripts/test-upscale-auth-csrf.mjs`
- `scripts/check-studio-api-contracts.mjs`

## Outcome

Stage 9G-2 recommends a local-first abuse-protection path:

- use current auth, CSRF, admin, audit, and rate-limit patterns
- do not add Arcjet, Redis, BullMQ, or external SaaS in this stage
- close ownership and generation-parameter guard gaps before broader abuse tooling
