> Historical audit snapshot. This file records an earlier 3107 security review and does not describe the current 3106 server deployment.

# Stage 9F-0 P0 Security Baseline Audit

Stage 9F-0 is a read-only audit and planning pass. It does not authorize or execute formal Batch C implementation, dual-write, read-path cutover, feature-flag change, rollback, migration, staging business writes, production DB access, production DB writes, real uploads import, provider or NewAPI calls, generation, cost, or any 3106 action.

## Scope Boundary

This document is limited to:

- read-only repo audit
- read-only document audit
- read-only 3107 runtime status and health review
- read-only staging DB identity, migration, and row-count summary
- planning-only remediation and open-source adaptation notes

This document does not include:

- code implementation
- dependency installation
- DB migration
- DB repair
- uploads import
- feature-flag cutover
- dual-write enablement
- read-path canary
- 3106 operation

## 1. Current State Confirmation

### Worktree

- worktree: `<local-3107-worktree>`
- runtime commit: `a263e000f34f2b7620f57157e9ef404255d8024a`
- 3107 health: `ok`
- `newApiCalled=false`
- service status summary:
  - listening: `true`
  - port: `3107`
  - home: `200`
  - `/api/health/backend`: `200`
  - `/api/library`: `200`

### 3106 Status

- 3106 remains the formal baseline
- 3106 was not read for runtime mutation, restart, deploy, upgrade, migration, or cutover in this stage

### Current Feature-Flag State

Current staging runtime env summary:

- `LIBRARY_STORAGE_BACKEND=json`
- `GENERATION_JOBS_BACKEND=existing`
- `DATABASE_LIBRARY_DUAL_WRITE=false`
- `DATABASE_LIBRARY_READ_ENABLED=false`
- `DATABASE_JOBS_WRITE_ENABLED=false`
- `DATABASE_IMPORT_DRY_RUN_ONLY=true`
- `RUNTIME_STORAGE_ISOLATION` env var: `unset`

Effective runtime note:

- 3107 still enforces strict storage isolation through the `PORT=3107` guard in runtime code, even when `RUNTIME_STORAGE_ISOLATION` is unset.

### Staging DB Identity Summary

This Stage 9F-0 snapshot used staging DB read-only SQL inside `BEGIN READ ONLY` and `ROLLBACK`. It did not write business data, run migration, or modify privileges.

Non-sensitive staging DB summary:

- host summary: `loopback:127.0.0.1`
- port: `5432`
- expected database name: `aohuang_app`
- current database: `aohuang_app`
- current user: `staging_user`
- current schema: `public`
- PostgreSQL version: `PostgreSQL 16.14`
- current session `transaction_read_only=on`
- expected DB name matches: `true`
- production signal detected: `false`

### Latest Migration

- `schema_migrations` exists: `true`
- applied migration count: `7`
- latest migration: `007_database_mvp_foundation`

### MVP Table Row Counts

Current staging row-count snapshot:

| table | exists | row count |
| --- | --- | ---: |
| `generation_jobs` | yes | 0 |
| `assets` | yes | 0 |
| `library_items` | yes | 0 |
| `provider_model_snapshots` | yes | 0 |
| `api_call_logs` | yes | 0 |
| `error_events` | yes | 0 |
| `audit_logs` | yes | 0 |
| `quota_accounts` | yes | 0 |
| `quota_ledger` | yes | 0 |

Current interpretation:

- Stage 9E migration work has landed in staging schema.
- Batch C formal implementation remains unauthorized.
- DB-backed tables exist but current 3107 runtime is still operating with DB feature flags default-safe and JSON/existing backends.

## 2. P0 Risk Audit

Risk labels used here:

- `CONFIRMED`: current code demonstrates a real P0 security gap
- `PARTIAL`: there is meaningful protection, but the control is incomplete
- `NOT_FOUND`: the claimed P0 issue is not currently supported by code evidence
- `UNKNOWN`: available evidence is insufficient for a reliable conclusion

---

### P0-1. Admin RBAC for `/admin/providers`, admin API, and provider config

**Current code evidence**

- `src/app/admin/providers/page.tsx`
  - page access requires a valid auth session and `session.user.role === "admin"`
- `src/lib/server/admin/http.ts`
  - admin API routes flow through `adminResponse(...)`
- `src/lib/server/admin/service.ts`
  - `requireAdmin()` returns `401` when unauthenticated and `403` when role is not admin
- `src/app/api/admin/providers/route.ts`
  - `GET` is admin-gated
  - `PUT` requires both admin auth and CSRF
- `src/lib/server/providers.ts`
  - public provider responses are sanitized through `sanitizeProvider()`
  - only `keyPreview` is exposed, not raw API keys
  - provider config persists to `data/providers.json`
- `src/lib/server/admin/__tests__/admin-api-smoke.test.ts`
  - anonymous and non-admin denial coverage exists

**Current risk level**

- `PARTIAL`

**Is there already protection**

- yes

**Gap**

- authorization is coarse `role === "admin"` only
- provider config is global and mutable by any admin, with no finer-grained provider-scope permissions
- provider secrets are still stored in local runtime JSON at rest

**Minimal fix**

- keep current page/API admin gate
- add a thin permission layer around provider config read/write, still inside existing admin surface
- separate provider-config read, secret-rotate, and enable/disable permissions in server code
- plan a later at-rest secret hardening path for provider keys

**Suggested stage**

- `9F-1 admin RBAC`
- `9F-5 env/secret leak guard`

**Needs DB migration**

- no for minimal RBAC tightening
- maybe later if provider-secret storage moves out of JSON and into managed encrypted persistence

**Needs 3107 verification**

- yes

**Affects 3106**

- no

**Test recommendation**

- add admin/provider authorization tests for:
  - admin read allowed
  - non-admin read denied
  - non-admin write denied
  - admin write allowed
  - sanitized response never exposes raw secret

---

### P0-2. 3107 / 3106 / production DB environment isolation

**Current code evidence**

- `src/lib/server/database/config.ts`
  - requires `APP_DATABASE_URL`
  - requires explicit `APP_DATABASE_EXPECTED_NAME`
- `src/lib/server/database/client.ts`
  - checks `current_database()` against expected name
- `src/lib/server/database/stage9cb-flags.ts`
  - DB runtime allowed only when staging runtime constraints are met
- `src/lib/server/runtime-paths.ts`
  - 3107 enforces isolated `DATA_DIR` and `UPLOADS_DIR`
- `scripts/ops/service-config.mjs`
  - staging and production service roots are separated
- Stage 9F-0 read-only DB summary:
  - loopback host
  - expected DB name matched
  - no production signal

**Current risk level**

- `PARTIAL`

**Is there already protection**

- yes

**Gap**

- current staging DB name is generic `aohuang_app`, not environment-distinct by name alone
- the current runtime credential is `staging_user`, which was previously proven over-privileged in Stage 9E-1 and should not be treated as a least-privilege runtime identity success story
- `RUNTIME_STORAGE_ISOLATION` is not explicitly set in the current runtime env, even though port-based enforcement still makes the effective state safe

**Minimal fix**

- keep `APP_DATABASE_EXPECTED_NAME` hard-fail guard
- keep 3107 storage isolation fail-closed behavior
- explicitly set `RUNTIME_STORAGE_ISOLATION=strict` in staging service config to remove ambiguity
- document and later reduce staging runtime DB privileges where feasible without breaking 3107
- prefer environment-distinct DB naming in a future controlled DB operations pass

**Suggested stage**

- `9F-7 3107 P0 regression`

**Needs DB migration**

- no

**Needs 3107 verification**

- yes

**Affects 3106**

- no

**Test recommendation**

- add a narrow staging preflight assertion that fails when:
  - `APP_DATABASE_EXPECTED_NAME` mismatches
  - staging points outside approved loopback/private target
  - explicit isolation flags drift

---

### P0-3. Ownership guard for library items, jobs, and asset download

**Current code evidence**

- `src/app/api/library/route.ts`
  - `GET` returns all items from `readLibrary()`
  - `DELETE` deletes by `id`
  - there is no `requireAuthSession()` and no ownership check
- `src/app/api/files/[name]/route.ts`
  - serves stored files by name
  - there is no auth gate and no ownership check
- `src/lib/server/library.ts`
  - JSON library reads and deletes are global
  - delete path removes file and item by `id` only
- `src/lib/server/provider-call.ts`
  - generation jobs record `ownerLocalUserId` and billing user ids
  - `refreshVideoJob(jobId, localUserId)` does enforce owner matching for job polling
- `src/lib/server/volcengine-upscale.ts`
  - video-upscale job refresh path also enforces owner matching

**Current risk level**

- `CONFIRMED`

**Is there already protection**

- partial only for job refresh endpoints

**Gap**

- library list is unauthenticated and global
- library delete is unauthenticated and global
- file download is unauthenticated and global
- ownership metadata exists for jobs, but is not consistently enforced across library/assets
- `LibraryItem` type currently has no owner field, which blocks consistent per-user filtering

**Minimal fix**

- require auth on `/api/library` and `/api/files/[name]`
- add `ownerLocalUserId` to library records
- filter library reads by current user
- require ownership on delete and file download
- preserve admin-only override as a separate explicit path if needed later

**Suggested stage**

- `9F-2 ownership guard`

**Needs DB migration**

- maybe
  - JSON-only minimal patch can start without migration
  - durable cross-backend ownership support will likely need schema alignment for DB-backed `library_items` and related asset joins

**Needs 3107 verification**

- yes

**Affects 3106**

- no

**Test recommendation**

- add end-to-end authorization coverage for:
  - user A cannot read user B items
  - user A cannot delete user B items
  - user A cannot download user B stored file
  - admin path remains explicit and tested if introduced

---

### P0-4. Server-side generation parameter validation

**Current code evidence**

- `src/app/api/generate/image/route.ts`
  - requires CSRF and auth session
- `src/app/api/generate/video/route.ts`
  - requires CSRF and auth session
- `src/lib/server/provider-call.ts`
  - provider readiness checks
  - prompt required checks
  - image-to-image requires reference image
  - video duration, ratio, and max-reference-image checks for provider families
  - server-side quota estimation and billing fingerprinting
- `src/app/api/upscale/image/route.ts`
  - scale limited to `1`, `2`, `4`
- `src/app/api/upscale/video/route.ts`
  - scale limited to `1`, `2`, `4`
- `uploadedMediaFromForm()`
  - max 10 files
  - type allowlist
  - 10MB image reference-file cap

**Current risk level**

- `PARTIAL`

**Is there already protection**

- yes

**Gap**

- no obvious generic max prompt length for generation routes
- image `quality` falls back loosely; unknown values collapse to default behavior instead of failing closed
- image ratio handling is permissive through default mapping
- no explicit generation endpoint rate limiting
- no strict provider/model allowlist policy beyond what current provider config exposes

**Minimal fix**

- centralize generation input schema validation
- add explicit prompt max length
- reject unknown `ratio`, `quality`, `mode`, and unsupported combinations instead of coercing
- add authenticated per-user rate limiting for generate and upscale endpoints

**Suggested stage**

- `9F-3 generation parameter guard`

**Needs DB migration**

- no

**Needs 3107 verification**

- yes

**Affects 3106**

- no

**Test recommendation**

- add invalid-input tests for:
  - oversized prompt
  - unsupported ratio
  - unsupported quality
  - unsupported duration
  - too many reference images
  - rate-limited repeated generate requests

---

### P0-5. File download / path traversal / local file access

**Current code evidence**

- `src/lib/server/runtime-paths.ts`
  - `resolveUploadPath()` and `resolveDataPath()` enforce root containment
- `src/lib/server/paths.ts`
  - `validateRuntimeStorageIsolation()` runs at import time
  - `safeStoredName()` strips unsafe filename characters
- `src/lib/server/library.ts`
  - `readStoredFile()` requires sanitized stored name
- `src/app/api/files/[name]/route.ts`
  - only reads via `readStoredFile(name)`
- static repo search found no explicit temp-table dependency and no evidence of filesystem path escape shortcuts in these routes

**Current risk level**

- `PARTIAL`

**Is there already protection**

- yes

**Gap**

- path traversal guard is materially present
- the remaining P0 issue is access control, not root containment
- file route is still public and not bound to user ownership

**Minimal fix**

- keep current root-containment and filename normalization
- add auth and ownership gate on `/api/files/[name]`
- optionally hard-bind stored files to a metadata lookup instead of trusting direct stored-name access

**Suggested stage**

- `9F-2 ownership guard`
- `9F-4 file path guard`

**Needs DB migration**

- no for route gate
- maybe later if asset indirection is moved fully into DB lookups

**Needs 3107 verification**

- yes

**Affects 3106**

- no

**Test recommendation**

- add route tests for:
  - `..`
  - absolute path
  - encoded traversal
  - bad filename normalization
  - authenticated owner allowed
  - authenticated non-owner denied

---

### P0-6. Env / secret leak guard

**Current code evidence**

- `src/lib/server/database/config.ts`
  - `server-only`
- `src/lib/server/database/client.ts`
  - `server-only`
- `src/lib/server/database/stage9cb-flags.ts`
  - `server-only`
- `src/lib/server/admin/service.ts`
  - redacts tokens, passwords, cookies, secrets, DSNs in audit text
- `src/lib/server/quota/task-billing-service.ts`
  - redacts sensitive fields in billing failure text
- `src/lib/server/error-diagnostics.ts`
  - redacts `APP_DATABASE_URL`, auth headers, cookies, token-like values
- static checks already present:
  - `scripts/security-release-check.mjs`
  - `scripts/database/bundle-scan.mjs`
  - `scripts/test-log-redaction.mjs`
  - `scripts/check-database-implementation-gate.mjs`
- `src/lib/server/providers.ts`
  - public provider output uses `keyPreview` only
  - full provider keys still persist in `data/providers.json`

**Current risk level**

- `PARTIAL`

**Is there already protection**

- yes

**Gap**

- at-rest provider secrets are still plaintext in runtime JSON config
- current guard strength is good for logs, bundles, and API responses, but weaker for local secret storage
- a machine compromise or accidental file exposure would reveal provider keys

**Minimal fix**

- keep existing bundle/log redaction checks
- harden provider secret storage plan:
  - minimum: isolate provider secrets from editable general config
  - stronger option: OS-protected secret store or encrypted file with clear rotation/runbook
- add a static audit that fails if secret-shaped values appear in tracked runtime config examples beyond approved fixtures

**Suggested stage**

- `9F-5 env/secret leak guard`

**Needs DB migration**

- no for static guard
- maybe later for structured secret persistence

**Needs 3107 verification**

- yes

**Affects 3106**

- no

**Test recommendation**

- extend redaction/bundle tests to cover provider-config serialization and admin provider update error paths

---

### P0-7. Generation failure / timeout / refund lifecycle

**Current code evidence**

- `src/lib/server/quota/task-billing-service.ts`
  - precheck
  - verify precheck
  - claim dispatch
  - provider-started
  - accept
  - settle success
  - fail/cancel without charge
  - refund after settlement
  - reconciliation-required handling
  - stale dispatch guard via `providerDispatchTimeoutMs = 2 * 60 * 1000`
- `src/lib/server/provider-call.ts`
  - image/video generation integrates billing precheck, dispatch claim, accept, settle, fail handling
- `src/lib/server/quota/__tests__/task-billing-service.test.ts`
  - coverage exists for:
    - insufficient quota
    - matching precheck
    - dispatch idempotency
    - settlement
    - fail/cancel before settlement
    - refund after settlement
    - reconciliation-required
    - crash/retry recovery

**Current risk level**

- `PARTIAL`

**Is there already protection**

- yes

**Gap**

- there is a mature billing state machine, but no independent queue/worker boundary yet
- timeout handling is tied to request/task lifecycle and stale dispatch heuristics, not a separate durable sweeper or worker system
- user cancellation exists in service logic, but broader HTTP/UI cancellation contract is not yet the center of the runtime flow

**Minimal fix**

- keep current billing state machine
- add explicit observability and regression coverage around stale dispatch and reconciliation-required cases
- defer queue infrastructure changes unless sustained async workload justifies it

**Suggested stage**

- `9F-6 refund/timeout lifecycle`

**Needs DB migration**

- no for logic hardening and tests
- maybe later if lifecycle monitoring/audit tables expand

**Needs 3107 verification**

- yes

**Affects 3106**

- no

**Test recommendation**

- add targeted 3107 regression pack for:
  - stale dispatch timeout
  - settle-then-fail refund
  - duplicate settle idempotency
  - reconciliation-required alert path

## 3. Open-Source Adaptation Matrix

This section evaluates external projects for design borrowing only. It does not authorize code copying, dependency installation, or direct integration.

### A. Imago

Reference used:

- `https://github.com/tenngoxars/Imago`

Observed project profile:

- open-source full-stack AI image generation application architecture
- credit/payment system
- prompt-building flow
- image/video generation product surface

Borrowable ideas:

- credit system packaging and user-facing quota UX
- prompt-builder UX structure
- image/video generation workflow framing
- commercial-product-shaped information architecture

Non-fit points:

- likely larger auth, payment, and product-surface scope than this repo needs for P0
- architecture appears broader than the current repo’s immediate narrow security fixes

License risk:

- repository surface indicates open-source AI app architecture, but this Stage 9F-0 review did not rely on vendoring or copying code
- exact downstream reuse policy should still be checked before any code-level adoption

Recommendation:

- `design reference only`
- do not introduce now
- useful for later UX and quota-product framing, not for immediate P0 baseline work

### B. Nova Image Studio

Reference used:

- `https://github.com/tianjiangqiji/nova-image-studio`

Observed project profile:

- self-hosted AI image studio
- task system
- multi-mode workbench
- local result serving
- AGPL-3.0

Borrowable ideas:

- queue/task UI conventions
- model-level provider configuration concepts
- result-serving workflow ideas
- TTL cleanup and task-progress product patterns

Non-fit points:

- AGPL-3.0 makes direct code adoption high-risk for this repo
- likely broader workbench/runtime scope than current P0 needs

License risk:

- `high`
- treat as design reference only
- do not copy code into this repo

Recommendation:

- `design reference only`
- no code adoption
- useful as a product-pattern comparator, not as an implementation source

### C. Vercel AI SDK / Image Generator

References used:

- `https://ai-sdk.dev/docs/ai-sdk-core/image-generation`
- `https://ai-sdk.dev/docs/reference/ai-sdk-core/provider-registry`
- `https://github.com/vercel/ai`

Borrowable ideas:

- provider abstraction
- provider registry
- unified model addressing
- normalized image-generation API shape
- error-handling standardization

Non-fit points:

- current repo already has provider-specific and custom business logic around billing, library records, and upscale flows
- swapping to AI SDK would not remove the need for local authorization, ownership, billing, and file-safety controls

License risk:

- low from an open-source adoption perspective, but still requires a normal dependency review

Recommendation:

- `not P0`
- good `P1/P2` candidate if provider abstraction becomes painful
- do not introduce during immediate P0 remediation

### D. Better Auth

References used:

- `https://github.com/better-auth/better-auth`
- `https://better-auth.com/docs/plugins/admin`
- `https://better-auth.com/docs/concepts/session-management`

Borrowable ideas:

- richer role and permission model
- admin plugin role patterns
- session-management conventions
- account security defaults

Non-fit points:

- this repo already has an auth/session system in place
- full auth-framework replacement would be much larger than the immediate RBAC and ownership fixes

License risk:

- low

Recommendation:

- do not replace auth now
- for current repo, a minimal in-repo RBAC tightening is faster and safer
- Better Auth is a future architecture option, not the immediate P0 path

### E. BullMQ

References used:

- `https://github.com/taskforcesh/bullmq`
- `https://docs.bullmq.io/guide/retrying-failing-jobs`
- `https://docs.bullmq.io/guide/workers/concurrency`
- `https://docs.bullmq.io/patterns/timeout-jobs`

Borrowable ideas:

- queue semantics
- retry policy
- concurrency control
- timeout/stall handling
- durable async worker boundary

Non-fit points:

- adds a Redis dependency
- current repo already has a meaningful billing and reconciliation state machine
- this is not needed to close the current P0 ownership/auth baseline

License risk:

- low

Recommendation:

- `not P0`
- reasonable `P1` if async generation throughput or worker durability becomes a pain point
- do not introduce now

### F. UploadThing

References used:

- `https://github.com/pingdotgg/uploadthing`
- `https://docs.uploadthing.com/file-routes`
- `https://docs.uploadthing.com/concepts/auth-security`
- `https://docs.uploadthing.com/uploading-files`

Borrowable ideas:

- file route abstraction
- per-route size/type guard
- auth middleware on upload routes
- signed upload flow

Non-fit points:

- current repo uses local runtime uploads and local result serving
- immediate P0 issue is auth/ownership on existing local routes, not lack of a managed upload SaaS

License risk:

- low

Recommendation:

- first fix local ownership/path/access guard in-place
- UploadThing is a later architecture choice if the repo moves away from local uploads
- not needed for immediate P0 closure

### G. Arcjet or similar Next.js rate-limit / bot / attack protection

References used:

- `https://github.com/arcjet/arcjet-js`
- `https://github.com/arcjet/example-nextjs`
- `https://github.com/arcjet/example-nextjs-bot-protection`

Borrowable ideas:

- login anti-bruteforce
- generation endpoint rate limiting
- bot/cost protection
- attack-protection layering for public routes

Non-fit points:

- introduces another runtime integration surface
- current repo can likely close the immediate gap faster with local in-process rate limiting for generation endpoints

License risk:

- low

Recommendation:

- treat as `P1`
- for `P0`, first add local authenticated rate limiting to generation/upscale endpoints
- consider Arcjet later if bot pressure or public abuse grows materially

## 4. Pragmatic Route

### What can be batched in one PR

Safe combined batch:

- ownership guard for `/api/library`
- ownership guard for `/api/files/[name]`
- auth requirement for those routes
- small supporting tests

Reason:

- these controls solve the strongest confirmed P0 issue with one coherent server-surface patch

### What should stay split

Keep separate:

- admin RBAC tightening
- generation input guard + rate limit
- secret at-rest hardening
- refund/timeout lifecycle regression pack
- staging runtime/isolation regression pack

Reason:

- these have different risk surfaces and different validation flows

### OSS projects that should remain reference-only

- `Imago`: reference only
- `Nova Image Studio`: reference only, do not copy code

### Dependencies that can wait

- `Vercel AI SDK`: later provider abstraction candidate
- `BullMQ`: later worker/queue candidate
- `UploadThing`: later upload architecture candidate
- `Arcjet`: later public-abuse protection candidate
- `Better Auth`: later auth-architecture candidate, not a near-term swap

### Dependencies that should not be introduced now

- AGPL/GPL implementation code from external studio repos
- Redis queue stack for P0-only scope
- full auth-framework replacement
- managed upload stack while local ownership/access is still unresolved

### Batch C recommendation

- recommend pausing formal Batch C implementation until the `CONFIRMED` ownership/access P0 is closed
- current repo has meaningful staging groundwork, but ownership and asset access are not at a formal security baseline yet

## 5. Suggested PR Split

### 9F-1 admin RBAC

- goal: tighten admin/provider authorization and audit boundary without changing product scope
- DB change: no
- migration: no
- 3107 refresh/restart: maybe, only if runtime code changes require it
- touch 3106: no
- test commands:
  - `npm run lint`
  - `npm run typecheck`
  - `npm run check`
- rollback: revert RBAC patch and keep current coarse admin gate

### 9F-2 ownership guard

- goal: require auth and per-user ownership for library reads, library deletes, file download, and job-adjacent asset access
- DB change: maybe
- migration: maybe, depending on whether owner metadata is added to DB-backed library records in the same PR
- 3107 refresh/restart: yes if runtime route changes land
- touch 3106: no
- test commands:
  - `npm run lint`
  - `npm run typecheck`
  - `npm run check`
- rollback: revert route gating patch and restore current library/file route behavior

### 9F-3 generation parameter guard

- goal: fail closed on unsupported prompt/ratio/quality/duration/count inputs and add generation rate limiting
- DB change: no
- migration: no
- 3107 refresh/restart: yes if runtime route changes land
- touch 3106: no
- test commands:
  - `npm run lint`
  - `npm run typecheck`
  - `npm run check`
- rollback: revert validation/rate-limit patch

### 9F-4 file path guard

- goal: keep current containment checks and formalize route-level access gating plus negative traversal tests
- DB change: no
- migration: no
- 3107 refresh/restart: maybe
- touch 3106: no
- test commands:
  - `npm run lint`
  - `npm run typecheck`
  - `npm run check`
- rollback: revert only route-guard delta

### 9F-5 env/secret leak guard

- goal: strengthen secret-at-rest plan and extend static leak detection
- DB change: no for initial guard pass
- migration: no
- 3107 refresh/restart: maybe if runtime secret-loading shape changes
- touch 3106: no
- test commands:
  - `npm run lint`
  - `npm run typecheck`
  - `npm run check`
- rollback: revert new static checks or storage abstraction changes

### 9F-6 refund/timeout lifecycle

- goal: close remaining timeout/observability gaps around stale dispatch, reconciliation, cancellation, and refund safety
- DB change: no for logic/test pass
- migration: no
- 3107 refresh/restart: maybe
- touch 3106: no
- test commands:
  - `npm run lint`
  - `npm run typecheck`
  - `npm run check`
- rollback: revert lifecycle hardening patch

### 9F-7 3107 P0 regression

- goal: add preflight/regression coverage for staging runtime isolation, expected DB identity, and default-safe flag state
- DB change: no
- migration: no
- 3107 refresh/restart: no for static/test-only work, maybe for runtime-config hardening
- touch 3106: no
- test commands:
  - `npm run lint`
  - `npm run typecheck`
  - `npm run check`
- rollback: revert regression checks only

## 6. Stage 9F-0 Conclusion

### P0 Audit Summary

Current Stage 9F-0 judgment:

- strongest confirmed P0: ownership and access control on library/files
- strongest partial controls already present:
  - admin page/API gate
  - DB identity guard
  - path containment guard
  - log/bundle secret redaction
  - billing/refund state machine
- recommended immediate sequence:
  1. `9F-2 ownership guard`
  2. `9F-3 generation parameter guard`
  3. `9F-1 admin RBAC`
  4. `9F-5 env/secret leak guard`
  5. `9F-6 refund/timeout lifecycle`
  6. `9F-7 3107 P0 regression`

### Security Boundary Confirmation

This Stage 9F-0 audit:

- did not enable dual-write
- did not switch read path
- did not change feature flags
- did not execute rollback
- did not run migration
- did not write staging business data
- did not connect to production DB
- did not write production DB
- did not read or import real uploads
- did not call NewAPI
- did not call a real provider
- did not trigger real generation
- did not incur cost
- did not operate 3106
- did not enter formal Batch C implementation
- did not enter production / 3106 cutover

### Monitor Gate Recommendation

- `Stage 9F-0 P0 security baseline audit: READY FOR MONITOR REVIEW`
- permission to start P0 fixes: `不允许，需用户另行授权`
- permission to continue formal Batch C implementation: `不允许，需用户另行授权`
- permission to operate 3106: `不允许，需用户另行授权`
