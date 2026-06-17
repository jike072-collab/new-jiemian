# New API API Auth Matrix

## Scope

This matrix records the official authentication and authorization behavior visible in the New API source tree and docs.

## Matrix

| Interface group | Representative paths | Auth rule | Notes |
| --- | --- | --- | --- |
| Setup / bootstrap | `GET /api/setup`, `POST /api/setup` | No auth | Public initialization entry point. |
| Public info | `GET /api/status`, `GET /api/about`, `GET /api/notice`, `GET /api/pricing`, `GET /api/rankings` | No auth or public-module gate | Informational surfaces only. |
| Login / register | `POST /api/user/login`, `POST /api/user/register`, `GET /api/user/logout` | No auth | Login creates a session; register is open when feature flags allow it. |
| User self-service | `GET /api/user/self`, `PUT /api/user/self`, `DELETE /api/user/self`, `GET /api/user/token`, `GET /api/user/topup/self`, `POST /api/user/topup` | `UserAuth` | Session cookie or access token auth, then `New-Api-User` header must match the authenticated user id. |
| Token management | `GET /api/token`, `POST /api/token`, `PUT /api/token`, `DELETE /api/token/:id` | `UserAuth` | Tokens belong to the logged-in user. |
| Read-only token auth | `GET /api/usage/token`, `GET /api/log/token` | `TokenAuthReadOnly` | Uses `Authorization` bearer/sk token, then checks the token record. |
| User admin | `GET /api/user`, `GET /api/user/:id`, `POST /api/user`, `POST /api/user/manage`, `PUT /api/user`, `DELETE /api/user/:id` | `AdminAuth` | Includes create, search, disable, enable, delete, promote, demote, and quota adjustments. |
| Channel admin | `GET /api/channel`, `POST /api/channel`, `PUT /api/channel`, `DELETE /api/channel/:id`, `POST /api/channel/:id/key` | `AdminAuth` with some `RootAuth` subroutes | Secret/key reads and some upstream operations are root-only. |
| Model admin | `GET /api/models`, `POST /api/models`, `PUT /api/models`, `DELETE /api/models/:id` | `AdminAuth` | Model metadata and sync control. |
| Logs and stats | `GET /api/log`, `GET /api/log/self`, `GET /api/log/stat`, `GET /api/data`, `GET /api/data/self` | Mixed `AdminAuth` / `UserAuth` | Admin gets platform-wide views; users get self views. |
| Tasks | `GET /api/task/self`, `GET /api/task` | Mixed `UserAuth` / `AdminAuth` | User sees own tasks; admin sees all. |
| Root settings | `GET /api/option`, `PUT /api/option`, `POST /api/performance/*`, `POST /api/ratio_sync/*`, `GET /api/custom-oauth-provider`, `POST /api/custom-oauth-provider` | `RootAuth` | System-wide controls only. |
| Payment callbacks | `POST /api/user/epay/notify`, `POST /api/stripe/webhook`, `POST /api/creem/webhook`, `POST /api/waffo/webhook`, `POST /api/waffo-pancake/webhook/:env` | No auth, but signature/config validation | These are public callback endpoints with gateway-specific validation. |

## Session And Token Semantics

- `UserAuth` accepts either a valid session or a valid access token.
- If session auth is used, the request must still carry a matching `New-Api-User` header.
- `AdminAuth` and `RootAuth` are role gates layered on the same helper.
- `Authorization` bearer tokens are accepted for token-based auth.
- Read-only token endpoints use token validation instead of session validation.
- Disabled users are rejected by the auth middleware before handler logic runs.
- Admin and root write routes are tied into management audit logging in the middleware chain.

## Official Role Shape

- Common user: normal login user
- Admin: platform operator
- Root: highest privilege, including system settings and custom OAuth controls

## Notes

- The auth matrix is not just "login vs no login"; it is a layered policy across sessions, access tokens, user ids, and role level.
- The matrix confirms that New API already has a fully formed backend auth model, which is why B04 must choose only one truth source for this project.
