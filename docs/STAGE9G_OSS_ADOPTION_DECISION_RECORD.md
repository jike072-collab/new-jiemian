# Stage 9G-0 OSS Adoption Decision Record

Stage 9G-0 is a planning-only ADR for open-source reference usage and future dependency evaluation.

This document does not authorize or execute code copying, dependency installation, provider integration, Batch C implementation, migration, database write, production access, real uploads import, real uploads mutation, NewAPI call, provider call, generation, or cost-incurring work.

## Hard Boundary

The following rules apply to all open-source adoption work in this repo unless a later prompt explicitly authorizes a narrower exception:

- no copying external code into this repo by default
- no vendoring AGPL or GPL implementation code
- no new dependency installation by default
- no auth-framework replacement during current 9F / 9G work
- no queue-stack introduction during current 9F / 9G work
- no upload-service replacement during current 9F / 9G work
- no provider abstraction rewrite during current 9F / 9G work
- no 3106 operation
- no production DB access
- no production config change
- no real provider or NewAPI call
- no generation trigger
- no cost-incurring action

If a later task wants to adopt code, add a dependency, or change a runtime architecture boundary, that task needs separate user authorization and its own focused PR.

## Current Decision Context

Current repo direction remains:

1. finish the 9F security baseline repair lane first
2. keep 3106 untouched
3. use 3107 for staging-only verification
4. prefer small in-repo fixes over large framework swaps
5. treat external projects as product or architecture references unless explicitly approved otherwise

The Stage 9F audit already established the current execution order:

1. `9F-2 ownership guard`
2. `9F-3 generation parameter guard`
3. `9F-1 admin RBAC`

That order remains more important than any external dependency adoption.

## Default Adoption Policy

### Code Copy Policy

Default answer: `no`.

Code copying is not allowed unless all of the following are true:

- license compatibility is confirmed
- exact copied scope is identified
- the user explicitly authorizes code-level reuse
- the change is reviewed in a dedicated PR
- attribution and compliance obligations are documented

### Dependency Addition Policy

Default answer: `no`.

New dependencies are not allowed unless all of the following are true:

- the problem cannot be solved reasonably with current repo patterns
- the dependency does not expand the runtime risk disproportionately
- license and maintenance cost are acceptable
- a dedicated authorization is granted
- the dependency lands in its own scoped PR

## Decision Table

| Reference | Borrowable Areas | Do Not Adopt Directly | License Risk | Code Copy Allowed | Dependency Addition Allowed Now | Current Decision |
| --- | --- | --- | --- | --- | --- | --- |
| `Imago` | credit/quota UX, prompt builder, image/video studio information architecture, payment and credit lifecycle framing | auth architecture, DB schema, payment provider binding, direct implementation details | medium until separately verified | no | no | product and UX reference only |
| `Nova Image Studio` | task queue concepts, WebSocket progress ideas, TTL cleanup concepts, model-level provider config patterns | any implementation code, any AGPL-coupled runtime pattern copied verbatim | high | no | no | design reference only, no code adoption |
| `Vercel AI SDK / Image Generator` | provider abstraction, unified image generation API shape, typed provider interface, error handling pattern | immediate provider-layer rewrite, billing/library/auth behavior changes hidden behind a new abstraction | low | no | no for current P0/P1 | reevaluate only when provider-layer refactor is separately authorized |
| `Better Auth` | admin role ideas, session and role model, account-security conventions | full auth replacement, session migration, current auth architecture swap | low | no | no | keep current auth, do minimum in-repo RBAC first |
| `BullMQ` | queue model, concurrency, retry, timeout, delayed jobs | immediate queue-stack replacement, Redis-dependent runtime path, worker architecture introduction during current lane | low | no | no | future P1 candidate only after Redis ops review |
| `UploadThing` | upload size/type guard, signed upload concepts, auth middleware patterns | replacing current local uploads path before fixing current local access/path guard | low | no | no | fix local upload safety first, revisit later |
| `Arcjet` or similar | rate limit, bot protection, login anti-bruteforce, cost protection patterns | adding third-party runtime dependency during current lane, delegating core guard logic prematurely | low | no | no | do local rate-limit and validation first, revisit later |

## Per-Reference Record

### 1. Imago

Reference type:

- product and interaction reference

Borrowable:

- credit and quota packaging for user-facing UX
- prompt-builder flow
- image and video studio framing
- payment and credit lifecycle concepts

Do not adopt directly:

- auth architecture
- database schema
- payment-provider binding
- large-scope implementation patterns that assume a broader product surface

Decision:

- use for product reference only
- do not copy code
- do not add dependency
- do not let this block or reshape current 9F repair work

### 2. Nova Image Studio

Reference type:

- architecture and product-pattern reference

Borrowable:

- task queue design ideas
- WebSocket progress concepts
- TTL cleanup concepts
- model-level provider configuration shape

License note:

- `AGPL-3.0`
- treat as high-risk for code reuse

Decision:

- design reference only
- no code copying into repo
- no vendoring
- no dependency introduction

### 3. Vercel AI SDK / Image Generator

Reference type:

- provider abstraction reference

Borrowable:

- provider abstraction
- unified image generation API
- typed provider interface patterns
- error handling normalization

Do not adopt directly right now:

- provider-layer rewrite during active 9F / 9G work
- abstraction that hides existing billing, ownership, library, and upscale behavior before those contracts are stabilized

Decision:

- current P0/P1: do not introduce
- reevaluate only after a separate provider-layer refactor proposal exists

### 4. Better Auth

Reference type:

- auth and RBAC reference

Borrowable:

- admin role and permission model ideas
- session and role conventions
- account-security defaults

Do not adopt directly right now:

- full auth replacement
- migration of current auth/session architecture

Decision:

- do not replace auth now
- complete minimum repo-local RBAC and ownership fixes first
- revisit only as a future auth-architecture ADR or migration proposal

### 5. BullMQ

Reference type:

- queue and worker architecture reference

Borrowable:

- queue semantics
- concurrency controls
- retry policy
- timeout policy
- delayed-job handling

Do not adopt directly right now:

- Redis-backed queue stack
- worker architecture introduction during the current stabilization lane

Decision:

- not a current-lane dependency
- possible P1 candidate after Redis operations cost, failure modes, and deployment burden are reviewed

### 6. UploadThing

Reference type:

- upload architecture reference

Borrowable:

- upload size and type guard patterns
- signed upload flow concepts
- auth middleware patterns on upload routes

Do not adopt directly right now:

- managed upload replacement before current local upload access and path guard work is complete

Decision:

- first fix local access/path/ownership guard
- revisit only if the product later moves away from local uploads

### 7. Arcjet Or Similar Protection Layer

Reference type:

- abuse-protection reference

Borrowable:

- rate-limit patterns
- bot and cost protection concepts
- login anti-bruteforce patterns

Do not adopt directly right now:

- third-party runtime dependency for a guard the repo can first implement locally

Decision:

- do not introduce now
- first do local rate limit, validation, and audit improvements
- revisit only if public abuse pressure justifies the extra runtime surface

## License Risk Table

| Item | License / Status | Risk | Repo Rule |
| --- | --- | --- | --- |
| `Imago` | open-source reference reviewed at product level only | medium until separately verified for code-level reuse | reference only |
| `Nova Image Studio` | `AGPL-3.0` | high | no code copying, no vendoring |
| `Vercel AI SDK` | permissive open-source dependency surface | low | no current adoption without separate authorization |
| `Better Auth` | permissive open-source dependency surface | low | no current adoption without separate authorization |
| `BullMQ` | permissive open-source dependency surface | low | no current adoption without separate authorization |
| `UploadThing` | permissive open-source dependency surface | low | no current adoption without separate authorization |
| `Arcjet` | commercial/open-source mixed ecosystem, dependency and service review still needed | medium | no current adoption without separate authorization |

## Recommended Adoption Order

Recommended priority is to avoid adoption first, then add only what the repo demonstrably needs.

1. finish current in-repo security repairs:
   - `9F-2 ownership guard`
   - `9F-3 generation parameter guard`
   - `9F-1 admin RBAC`
2. complete `9G-1 operations observability baseline`
3. complete `9G-6 3107 manual regression script`
4. complete `9G-2 rate limit abuse protection plan`
5. complete `9G-3 backup restore operations runbook`
6. complete `9G-4 task queue architecture plan`
7. complete `9G-5 upload temp cleanup plan`
8. only then reevaluate whether a new dependency is still needed

If adoption is later justified, the recommended evaluation order is:

1. local guardrail improvements with no new dependency
2. `Vercel AI SDK` only if provider abstraction becomes the clear bottleneck
3. `BullMQ` only if durable async job handling becomes the clear bottleneck
4. `UploadThing` only if the product is ready to leave local uploads
5. `Arcjet` only if measured abuse pressure justifies it
6. `Better Auth` only as a future auth-architecture program, not an opportunistic swap

## Relationship To Current 9F / 9G Route

### Relation To 9F

- `9F-2 ownership guard` remains the highest-priority repair
- `9F-3 generation parameter guard` remains the next guardrail
- `9F-1 admin RBAC` remains an in-repo tightening task
- none of these require a framework swap or a new external runtime dependency

### Relation To 9G

- `9G-0` records what can be referenced without creating hidden adoption pressure
- `9G-1` and `9G-6` improve operational safety before any architecture expansion
- `9G-2` can define a local abuse-protection path before any Arcjet-style decision
- `9G-3` and `9G-5` improve recoverability and storage hygiene without changing product architecture
- `9G-4` can document queue evolution before any BullMQ or Redis decision

## Explicit No-Go Decisions For This Stage

The following are explicitly not approved by this ADR:

- copying AGPL or GPL code into the repo
- adding `Better Auth`
- adding `BullMQ`
- adding `UploadThing`
- adding `Arcjet`
- rewriting provider integration around `Vercel AI SDK`
- replacing current auth/session architecture
- replacing current local upload/storage architecture
- introducing Redis
- bundling any of the above into current P0 or 9G stabilization PRs

## Evidence Sources

This ADR is based on:

- current repo architecture and package surface
- `docs/STAGE9F_P0_SECURITY_BASELINE_AUDIT.md`
- current 9F task ordering and repo hard-boundary rules

It is a decision record, not an implementation authorization.
