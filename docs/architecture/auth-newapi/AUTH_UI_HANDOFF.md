# Auth UI Handoff

## Ownership

Line B owns the backend contract. Main line A owns the final login/register visual pages and shared UI.

B09 intentionally does not modify `src/app/login/page.tsx`, `src/components/customer-login.tsx`, the workbench shell, public header/sidebar, global styles, design tokens, or shared UI components.

## Required Page Behavior

Future UI should:

1. Call `GET /api/auth/csrf` before login, register, logout, or session refresh.
2. Send the returned token in `X-CSRF-Token`.
3. Submit JSON to `/api/auth/register` or `/api/auth/login`.
4. Use `uiState` to choose the visible state.
5. Never parse New API raw messages.
6. Never store long-lived auth tokens in localStorage.
7. Treat `mapping_pending` as local account created but cloud quota/actions blocked.

## UI State Mapping

| UI state | UI treatment |
| --- | --- |
| `idle` | Form ready. |
| `submitting` | Disable submit and show progress. |
| `success` | Continue to app or target route. |
| `invalid_credentials` | Show generic credential error. |
| `validation_error` | Show field validation or CSRF retry prompt. |
| `account_disabled` | Show account disabled message and support path. |
| `verification_required` | Show verification or manual review state. |
| `mapping_pending` | Show account created, cloud features pending. |
| `rate_limited` | Show retry-later state using `retryAfterSeconds` when present. |
| `service_unavailable` | Show temporary service failure. |
| `session_expired` | Prompt login again. |

## Data Available To UI

Successful auth responses include:

- `user.local_user_id`
- `user.email`
- `user.username`
- `user.display_name`
- `user.status`
- `user.role`
- `mappingStatus`
- `redirectTo`

They do not include password hash, session token, New API admin token, New API user token, New API cookie, provider key, or webhook secret.
