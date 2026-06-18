# Auth UI Requirements

## Ownership

Main line A owns visual implementation. Line B owns the backend contract.

The first screen may use existing visual shell work, but it must connect to real backend auth. It must not use fake login, localStorage-only auth, static user state, or New API browser credentials.

## Routes

| User action | Backend route | Required |
| --- | --- | --- |
| Get CSRF token | `GET /api/auth/csrf` | Before register, login, logout, refresh. |
| Register | `POST /api/auth/register` | CSRF. |
| Login | `POST /api/auth/login` | CSRF. |
| Logout | `POST /api/auth/logout` | CSRF and current session. |
| Current user | `GET /api/auth/session` | Session cookie. |
| Refresh session | `PATCH /api/auth/session` | CSRF and current session. |

## Required Form Behavior

- Normalize email and username exactly as server contract expects.
- Disable submit while `submitting`.
- Use generic copy for invalid credentials.
- Never reveal whether an account exists on login failure.
- Never log password, CSRF token, session cookie, or Authorization header.
- On successful register/login, use server `redirectTo` after open-redirect normalization.
- On `mapping_pending`, show account created or login succeeded but cloud features pending.

## UI States

| State | Required UI behavior |
| --- | --- |
| `idle` | Form ready. |
| `submitting` | Disable form and prevent duplicate submits. |
| `success` | Navigate or show signed-in app state. |
| `invalid_credentials` | Show generic login error. |
| `validation_error` | Show field or CSRF retry error. |
| `account_disabled` | Block login and show support path. |
| `verification_required` | Show manual review or verification state. |
| `mapping_pending` | Allow local account view, block quota/payment/workbench cloud actions. |
| `rate_limited` | Show retry-later state and honor `retryAfterSeconds`. |
| `service_unavailable` | Show temporary backend failure. |
| `session_expired` | Prompt login again and clear optimistic UI state. |

## Mobile Requirements

Mobile pages must support:

- registration and login forms without clipped validation text;
- session expired state;
- mapping pending state;
- account disabled state;
- rate-limited state;
- quota unavailable state after login;
- payment/recharge hidden or disabled when sandbox billing is off.

Do not implement desktop-only auth states.

## Session Rules

- The browser does not read the session token directly.
- The browser can rely on `GET /api/auth/session` response.
- No long-lived token goes into `localStorage`.
- Logout must call the backend and clear client optimistic state only after response or session-expired handling.
- Admin UI must use local `role: admin`; do not reuse the old provider admin password gate as customer auth.

## Required Data Handling

Auth responses expose:

- `local_user_id`
- `email`
- `username`
- `display_name`
- `status`
- `role`
- `mappingStatus`
- `redirectTo`

They must not expose:

- password hash;
- session token;
- CSRF secret internals;
- New API admin token;
- New API user token;
- New API cookie;
- provider API key;
- webhook secret.
