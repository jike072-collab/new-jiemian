# Auth API Contract

## Scope

B09 exposes real backend authentication APIs only. It does not implement the final login/register visual page.

The project account store is the only account truth source. The project HttpOnly session store is the only customer session truth source. New API remains a server-side mapped account used through B08.

## Routes

| Route | Method | Purpose | CSRF |
| --- | --- | --- | --- |
| `/api/auth/csrf` | `GET` | Issue a short-lived CSRF token and CSRF cookie. | No |
| `/api/auth/register` | `POST` | Create local account, sync New API mapping through B08, create project session. | Yes |
| `/api/auth/login` | `POST` | Verify local credentials and create a fresh project session. | Yes |
| `/api/auth/logout` | `POST` | Revoke the server-side project session and clear the session cookie. | Yes |
| `/api/auth/session` | `GET` | Return current local user and mapping status. | No |
| `/api/auth/session` | `PATCH` | Refresh the current session idle expiry. | Yes |

## Request Headers

State-changing requests must send:

```http
X-CSRF-Token: <token returned by /api/auth/csrf>
Cookie: aohuang_csrf=<same token>; aohuang_session=<session when present>
Content-Type: application/json
```

The browser never sends or receives New API admin credentials.

## Register

Request:

```json
{
  "email": "customer@example.com",
  "username": "customer",
  "password": "StrongPass123",
  "displayName": "Customer",
  "redirectTo": "/"
}
```

Success when New API mapping is active:

```json
{
  "ok": true,
  "uiState": "success",
  "user": {
    "local_user_id": "uuid",
    "email": "customer@example.com",
    "username": "customer",
    "display_name": "Customer",
    "status": "active",
    "role": "user"
  },
  "mappingStatus": "active",
  "redirectTo": "/"
}
```

Success with local account created but mapping not yet active:

```json
{
  "ok": true,
  "uiState": "mapping_pending",
  "mappingStatus": "failed"
}
```

The UI must treat `mapping_pending` as a real pending state, not a fake success for billable cloud actions.

## Login

Request:

```json
{
  "identifier": "customer@example.com",
  "password": "StrongPass123",
  "redirectTo": "/"
}
```

The identifier accepts either normalized email or username. Wrong password and missing account return the same `invalid_credentials` UI state.

## Logout

Logout revokes the server-side session. It does not call New API logout.

## Current Session

`GET /api/auth/session` returns the public local user and current New API mapping status when the project session is valid.

## Redirects

`redirectTo` must be a relative app path. Absolute URLs and protocol-relative URLs are normalized to `/` to block open redirects.
