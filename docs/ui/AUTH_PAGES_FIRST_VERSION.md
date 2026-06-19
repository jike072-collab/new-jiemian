# AUTH_PAGES_FIRST_VERSION

Branch: `feature/auth-pages`

## Scope

This task covers ordinary user login and registration pages only:

- `/login`
- `/register`
- password show/hide
- basic email/password validation
- submit loading state
- API error display
- mobile responsive layout

It does not modify the admin console, provider settings, API keys, PostgreSQL, server-side Session implementation, credits, recharge, payment, or B-side authentication logic.

## Existing Auth Interface Audit

| Capability | Existing route in repository | Result |
| --- | --- | --- |
| Login | Not found | The page posts to `/api/auth/login`, which currently returns the real missing-interface error from the app server. |
| Register | Not found | The page posts to `/api/auth/register`, which currently returns the real missing-interface error from the app server. |
| Current user | Not found | Session restore and workspace auth guard are blocked. |
| Logout | Not found | Real logout entry is blocked until the auth/session backend exists. |
| Admin access | `src/lib/server/admin-auth.ts` | Local/admin-only guard; not reused for ordinary users. |

No second authentication backend was created. No fake login state or fake session is introduced.

## Implemented Behavior

| Requirement | Result |
| --- | --- |
| Login page | `/login` renders email, password, password visibility toggle, submit, register link, validation, loading, and API errors. |
| Register page | `/register` renders email, password, confirm password, two password visibility toggles, submit, login link, validation, loading, and API errors. |
| Password visibility | Toggles between `password` and `text` input types with clear accessible names. |
| Basic validation | Invalid email, short password, and mismatched confirm password block submit. |
| Submit loading | Submit button enters loading state while the request is pending. |
| Interface error | Missing auth routes surface a clear error and do not redirect to the workbench. |
| Login success | Blocked until a real `/api/auth/login` route sets a session. |
| Register success | Blocked until a real `/api/auth/register` route creates a user/session. |
| Session restore | Blocked until a real current-user route exists. |
| Workspace guard | Blocked until server-side session/current-user behavior exists. |
| Logout | Blocked until a real logout route exists. |
| Mobile | 390px checks show no horizontal overflow on `/login` and `/register`. |

## Validation

- `/login` renders the new page.
- `/register` renders the new page.
- Login invalid email disables submit and shows validation.
- Login valid form posts to the current missing route and shows `认证接口尚未接入，暂时无法完成操作。`.
- Register mismatched passwords disable submit and show validation.
- Register valid form posts to the current missing route and shows `认证接口尚未接入，暂时无法完成操作。`.
- Password show/hide toggles were checked on `/login`.
- Mobile 390px `/login` and `/register` had no horizontal overflow.
