# Session Flow

## Truth Source

The only customer session truth source is the project session record stored by `src/lib/server/auth`.

New API cookies, New API access tokens, New API admin credentials, provider-admin `x-admin-password`, and browser localStorage are not customer sessions.

## Cookie Contract

| Cookie | Purpose | HttpOnly | Secure | SameSite | Path |
| --- | --- | --- | --- | --- | --- |
| `aohuang_session` | Project session token | yes | production or configured secure requests | `Lax` | `/` |
| `aohuang_csrf` | Double-submit CSRF token | no | production or configured secure requests | `Lax` | `/` |

Session token values are stored server-side only as SHA-256 hashes.

## Lifecycle

1. User requests `/api/auth/csrf`.
2. Browser stores `aohuang_csrf` and sends matching `X-CSRF-Token` on JSON mutations.
3. Register or login validates credentials on the server.
4. Login always creates a new project session token. If a previous project session is present, it is revoked.
5. Session cookie is HttpOnly and scoped to `/`.
6. `GET /api/auth/session` resolves the cookie to the server-side session and local user.
7. `PATCH /api/auth/session` refreshes idle expiry when the session and account remain valid.
8. Logout revokes the server-side session and clears the browser cookie.

## Expiry

- Idle expiry: 8 hours.
- Maximum lifetime: 14 days.
- Refresh extends idle expiry only; it does not extend the maximum lifetime.

## Session Fixation

Login regenerates the project session token. Existing session token, when present, is revoked before the new session is returned.

## Concurrent Sessions

B09 allows multiple sessions per account, but each session is independently stored and revocable. Account-level `session_version` is stored on the user and session record so later modules can force global logout by rotating the user version.

## Admin Sessions

Project admin is represented by local user role `admin`. B09 does not turn the existing provider-admin password header into a customer/admin session and does not create a New API admin browser session.
