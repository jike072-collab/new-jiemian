# Session Architecture

## Decision

The project BFF owns the only customer session truth source.

New API credentials, user sessions, admin sessions, and API tokens are never passed through to the browser as this app's login state.

## Cookie Contract

| Item | Decision |
| --- | --- |
| Cookie type | HttpOnly session cookie issued by this project. |
| Secure | `Secure=true` in HTTPS environments. Local development may use insecure localhost cookies only when explicitly configured. |
| SameSite | `Lax` by default for app navigation. Use stricter route-level CSRF checks for state-changing requests. |
| Path | `/` for the app session. |
| Domain | App domain only. Do not scope to the New API domain. |
| Browser access | JavaScript must not read the session cookie. |
| New API credentials | Never stored in browser cookies, localStorage, sessionStorage, or client state. |

## Lifecycle

| Phase | Policy |
| --- | --- |
| Login | BFF verifies local credentials, creates or refreshes the local session, and checks mapping state separately. |
| Register | BFF creates local user first, then creates or repairs New API mapping asynchronously or transactionally where possible. |
| Refresh | Sliding refresh may extend the local session when the user is active and the account remains enabled. |
| Expiry | Session expires after the configured maximum lifetime even if refresh occurs. |
| Logout | BFF invalidates the local session server-side and clears the app cookie. It does not rely on New API logout. |
| Password change | BFF rotates or invalidates existing user sessions. |
| Account disabled | BFF denies new session use and invalidates active sessions. |

## CSRF

- State-changing browser requests must require CSRF protection because the session cookie is automatically sent.
- SameSite is not a complete CSRF control.
- API routes that accept JSON mutations should require a CSRF token or same-origin double-submit/header contract in B09.
- Server-to-server BFF calls to New API do not use browser CSRF tokens.

## Concurrent Sessions

- Multiple user sessions may exist, but each session has its own server-side record or signed session version.
- Account-level `session_version` or equivalent must allow global logout and forced rotation.
- B09 must define device/session listing only if required by product UI. It is not required for the first backend contract.

## Admin Sessions

- Project admin access is a local project role or permission attached to `local_user_id`.
- New API admin/root credentials are operational secrets held server-side.
- A project admin session does not automatically become a New API admin session.
- Existing provider-admin `x-admin-password` behavior is not a customer/admin session model and must not be reused as the final account authority.

## New API Availability

- Users may log in and use local non-billable surfaces when New API is unavailable.
- Billable cloud actions must fail closed if the BFF cannot verify mapping and quota.
- Payment quota application must pause or mark repair-required when New API is unavailable.

## Forbidden Patterns

- Treating New API browser cookies as this app's session.
- Mirroring New API session cookies into this app's domain.
- Sending New API admin/root credentials to the browser.
- Storing New API user tokens in localStorage.
- Creating a second independent frontend login state that bypasses the BFF session.
