# Auth PostgreSQL Migration Audit

BP-01B implements PostgreSQL persistence for authentication, session, and New API user mapping without enabling production PostgreSQL primary writes by default. Runtime JSON repositories remain available for development and rollback evidence.

## Scope

- Included: `src/lib/server/auth/**`, `src/lib/server/integrations/new-api/*mapping*`, `src/lib/server/database/**`, `scripts/database/**`, `.github/workflows/application-database.yml`, `.env.example`, and this document.
- Excluded: A-side workbench, formal login/register UI, account center, admin UI, quota ledger changes, billing persistence, production payment, and PR #17 merge.
- Production rule: `APP_AUTH_PERSISTENCE_MODE` must be explicit. Missing production config fails closed.

## Current Data Audit

| Data | Current repository | Call entry | Concurrency risk | PostgreSQL target | Switch risk |
| --- | --- | --- | --- | --- | --- |
| Auth users | `src/lib/server/auth/repository.ts` `StoreAuthRepository.createUser`, `getUserByIdentifier`, `updateUser` over `data/auth-store.json` | `src/app/api/auth/register/route.ts` `POST` -> `AuthService.register`; `src/app/api/auth/login/route.ts` `POST` -> `AuthService.login`; `src/app/api/auth/session/route.ts` `GET/PATCH` -> `currentUser`/`refreshSession` | JSON queue is process-local. Multiple app instances can race on duplicate email/username and lose read-modify-write updates. | `app_users` through `src/lib/server/auth/postgres-repository.ts` `PostgresAuthRepository` | Password hash format and UUID validity must be preserved. Duplicate emails/usernames become database constraint failures mapped to `AUTH_DUPLICATE_ACCOUNT`. |
| Auth sessions | `src/lib/server/auth/repository.ts` `createSession`, `getSessionByTokenHash`, `touchSession`, `revokeSession` over `data/auth-store.json` | `AuthService.createSession`, `resolveSession`, `logout`, `refreshSession` | JSON can retain stale revoked sessions or lose session touch updates across app instances. | `auth_sessions` through `PostgresAuthRepository` | Only SHA-256 hex token hashes are valid. Raw tokens are never stored or migrated. |
| Auth audit events | `src/lib/server/auth/repository.ts` `appendAudit`, `listAuditEvents` over `data/auth-store.json` | `AuthService.audit` from register/login/session/logout paths | JSON audit order is per-process and file-bound. Loss reduces forensic evidence. | `audit_events.safe_details` through `PostgresAuthRepository.appendAudit` | Audit details must remain safe and must not contain passwords, cookies, Authorization, or raw session tokens. |
| New API user mapping | `src/lib/server/integrations/new-api/user-mapping.ts` `NewApiUserMappingStoreRepository` over `data/new-api-user-mappings.json` | `AuthService.syncMappingForRegistration` -> `NewApiUserSyncService.ensureMapped`; quota/billing still inject or use JSON mapping in their own modules until later modules migrate them | JSON optimistic version checks are only process-local and cannot enforce global uniqueness for `new_api_user_id`. | `new_api_user_mappings` through `src/lib/server/integrations/new-api/postgres-user-mapping.ts` | Active mappings require a valid local user row and unique `new_api_user_id`. Conflicts enter existing mapping error flow; no automatic upstream deletion. |

## Actual Call Chains

Registration:

`src/app/api/auth/register/route.ts` `POST`
-> `getAuthService().register`
-> `AuthService.register`
-> `AuthRepository.getUserByIdentifier`
-> `AuthRepository.createUser`
-> `AuthService.syncMappingForRegistration`
-> `NewApiUserSyncService.ensureMapped`
-> `NewApiUserMappingRepository.createPending/markActive/markFailed/scheduleRepair`
-> `AuthRepository.createSession`
-> `authResultResponse` writes the HttpOnly session cookie.

Login:

`src/app/api/auth/login/route.ts` `POST`
-> `AuthService.login`
-> `AuthRepository.getUserByIdentifier`
-> password verification
-> optional `logout` for existing cookie
-> `AuthRepository.updateUser`
-> `AuthRepository.createSession`
-> `NewApiUserMappingRepository.getByLocalUserId`
-> `authResultResponse`.

Session:

`src/app/api/auth/session/route.ts` `GET/PATCH`
-> `AuthService.currentUser` or `refreshSession`
-> `resolveSession`
-> `AuthRepository.getSessionByTokenHash`
-> `AuthRepository.getUserById`
-> `AuthRepository.touchSession` for refresh.

Logout:

`src/app/api/auth/logout/route.ts` `POST`
-> `AuthService.logout`
-> `AuthRepository.getSessionByTokenHash`
-> `AuthRepository.revokeSession`
-> `authActionResponse` clears the browser cookie.

## BP-01B Implementation

- `src/lib/server/auth/repository.ts` now names `UserRepository`, `SessionRepository`, and `AuthAuditRepository` while preserving the existing combined `AuthRepository` contract.
- `src/lib/server/auth/postgres-repository.ts` implements PostgreSQL user, session, and audit persistence.
- `src/lib/server/integrations/new-api/postgres-user-mapping.ts` implements PostgreSQL mapping persistence with existing status and optimistic version semantics.
- `src/lib/server/auth/persistence.ts` adds `APP_AUTH_PERSISTENCE_MODE=json|dual|postgres`.
- `src/lib/server/auth/dual-repair.ts` records redacted, persistent repair records when PostgreSQL shadow reads or writes fail after JSON primary persistence succeeds.
- `src/lib/server/auth/service.ts` uses the persistence selector only when repositories are not injected, preserving unit test and service dependency injection.
- `scripts/database/auth-data-migration.mjs` supports `dry-run`, `apply --confirm-apply`, and `verify`.
- `scripts/database/verify-auth-persistence.mjs` compares JSON and PostgreSQL counts/hashes with redacted output and can explicitly retry pending dual repair records with `--repair`.
- `.github/workflows/application-database.yml` now runs real PostgreSQL auth persistence and migration checks.

## Mode Behavior

| Mode | Read source | Write target | Intended use | Failure rule |
| --- | --- | --- | --- | --- |
| `json` | JSON | JSON | Development default and rollback evidence | No database is read. |
| `dual` | JSON primary | JSON plus PostgreSQL mirror | Controlled comparison window only | JSON remains authoritative. PostgreSQL shadow read/write failures do not fail an already successful JSON request; they create redacted repair records for explicit retry. |
| `postgres` | PostgreSQL | PostgreSQL | CI validation and future production cutover | Missing database config fails closed. |

Production without `APP_AUTH_PERSISTENCE_MODE` fails closed. BP-01B does not approve production PostgreSQL primary writes.

## Migration Rules

- `npm run migrate:auth-data:dry-run` reads JSON only and writes nothing.
- `npm run migrate:auth-data:apply` requires explicit `--confirm-apply` through the package script.
- `npm run migrate:auth-data:verify` reads source JSON and PostgreSQL counts.
- `npm run verify:auth-persistence` prints only counts and hashes, not raw user IDs, session token hashes, passwords, cookies, or database URLs.
- `npm run verify:auth-persistence -- --repair` retries pending dual repair records by replaying current JSON users, sessions, audit events, and mappings into PostgreSQL, then marks the redacted records as `repaired` or `failed`.
- `data/auth-dual-repair-records.json` is runtime state only. It stores scope, operation, hashed key, redacted key, status, retry count, and sanitized error details; it must not store passwords, raw session tokens, Authorization, Cookie, API keys, or database URLs.
- Orphan sessions and orphan mappings are rejected.
- Invalid session token hashes are rejected.
- Re-running apply is idempotent for unchanged source rows.

## Remaining Risks

- Production PostgreSQL primary writes remain disabled until release approval.
- Billing, quota usage, and reconciliation repositories still use their existing BP-01A/B10/B11 JSON persistence and need separate production migration modules.
- Local workstation verification could not run PostgreSQL integration tests without `APP_DATABASE_URL` and Docker. GitHub Actions is the required real PostgreSQL verification path for this branch.
- PostgreSQL image digest pinning remains a production blocker from B12-FG.
