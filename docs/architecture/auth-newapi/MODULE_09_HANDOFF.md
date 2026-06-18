# Module 09 Handoff

## Completed Scope

B09 adds the real backend authentication foundation:

- local project account repository;
- password strength validation and scrypt password hashing;
- registration, login, logout, current user, and session refresh APIs;
- HttpOnly project session cookie;
- CSRF token and cookie;
- login and registration rate limiting;
- audit logging with sensitive field redaction;
- registration mapping through B08 `NewApiUserSyncService`;
- route helper for session protection.

It does not build final login/register UI.

## Files Added

| File | Purpose |
| --- | --- |
| `src/lib/server/auth/types.ts` | Account, session, audit, and UI state contracts. |
| `src/lib/server/auth/repository.ts` | Runtime JSON account/session/audit repository. |
| `src/lib/server/auth/password.ts` | Password validation, scrypt hash, and verify helpers. |
| `src/lib/server/auth/cookies.ts` | Session and CSRF cookie helpers. |
| `src/lib/server/auth/csrf.ts` | CSRF token generation and verification. |
| `src/lib/server/auth/rate-limit.ts` | In-memory auth rate limiter. |
| `src/lib/server/auth/normalize.ts` | Identifier and redirect normalization. |
| `src/lib/server/auth/secrets.ts` | Server-side session secret helpers. |
| `src/lib/server/auth/service.ts` | Registration, login, logout, session, refresh, and audit service. |
| `src/lib/server/auth/http.ts` | API response helpers and session guard. |
| `src/lib/server/auth/index.ts` | Server auth public exports. |
| `src/app/api/auth/csrf/route.ts` | CSRF route. |
| `src/app/api/auth/register/route.ts` | Registration route. |
| `src/app/api/auth/login/route.ts` | Login route. |
| `src/app/api/auth/logout/route.ts` | Logout route. |
| `src/app/api/auth/session/route.ts` | Current session and refresh route. |
| `scripts/test-auth-session.mjs` | B09 test runner. |
| `.github/workflows/auth-session.yml` | PR validation for auth/session paths. |

## Runtime Data

The current temporary repository writes to `data/auth-store.json`. The `data/` directory is ignored by Git.

This is a development/runtime persistence path. Production still needs a formal database schema and migration runner.

## API Contract

See `AUTH_API_CONTRACT.md` and `AUTH_ERROR_CODES.md`.

State-changing auth calls require:

- `X-CSRF-Token`;
- `aohuang_csrf` cookie;
- `aohuang_session` cookie when already logged in;
- JSON body.

## Session Contract

- Cookie name: `aohuang_session`.
- CSRF cookie name: `aohuang_csrf`.
- HttpOnly: yes for session.
- Secure: yes in production.
- SameSite: Lax.
- Path: `/`.
- Idle lifetime: 8 hours.
- Absolute lifetime: 14 days.
- Login rotates any existing session.
- Logout revokes server-side session.
- New API credentials are never placed in the cookie.

## Mapping Boundary

Registration creates the local account first and then calls B08 mapping sync.

If mapping is not active:

- local account may exist;
- local login can succeed;
- cloud quota, recharge, and billable Workbench tasks must be blocked;
- UI must show `mapping_pending` or a repair state.

## Verification Coverage

B09 tests cover:

- registration success;
- duplicate registration;
- weak password;
- concurrent registration;
- mapping failure;
- login success;
- wrong password and missing user with the same public error;
- disabled user;
- verification-required user;
- rate limiting;
- session expiry;
- logout;
- route protection helper;
- refresh;
- CSRF;
- open redirect protection;
- audit redaction;
- cookie attributes.

## Open Risks

- No email verification or password reset was added because it was not present in the project and was outside B09.
- No OAuth, passkey, or third-party login was added.
- Runtime JSON storage is not production database persistence.
- Existing provider-admin route remains a separate legacy admin gate and must not be treated as project customer/admin auth.
