# Auth Error Codes

Frontend pages must read stable `uiState` and `code` values. They must not parse raw New API messages.

| Code | HTTP | UI state | Meaning |
| --- | --- | --- | --- |
| `AUTH_VALIDATION_ERROR` | 400 | `validation_error` | Invalid email, username, password strength, JSON shape, or CSRF input. |
| `AUTH_DUPLICATE_ACCOUNT` | 409 | `validation_error` | Email or username already belongs to a local account. |
| `AUTH_INVALID_CREDENTIALS` | 401 | `invalid_credentials` | Identifier or password is wrong. This intentionally does not reveal whether the account exists. |
| `AUTH_ACCOUNT_DISABLED` | 403 | `account_disabled` | Local account is disabled. |
| `AUTH_VERIFICATION_REQUIRED` | 403 | `verification_required` | Local account exists but cannot start a normal session until manual or policy verification completes. |
| `AUTH_MAPPING_PENDING` | 202 | `mapping_pending` | Local account exists, but New API mapping is not active yet. |
| `AUTH_RATE_LIMITED` | 429 | `rate_limited` | Login or registration attempts exceeded the server-side rate limit. |
| `AUTH_SERVICE_UNAVAILABLE` | 503 | `service_unavailable` | Registration could not safely record or continue mapping state. |
| `AUTH_SESSION_EXPIRED` | 401 | `session_expired` | Session missing, expired, revoked, or invalidated by account version. |
| `AUTH_CSRF_REQUIRED` | 403 | `validation_error` | Missing, mismatched, expired, or tampered CSRF token. |

## UI States

B09 reserves the following complete UI state set:

- `idle`
- `submitting`
- `success`
- `invalid_credentials`
- `validation_error`
- `account_disabled`
- `verification_required`
- `mapping_pending`
- `rate_limited`
- `service_unavailable`
- `session_expired`

## Logging

Audit logs may include local user ID, request ID, IP/user-agent hashes, event name, and sanitized machine details. They must not include passwords, session tokens, cookies, Authorization headers, New API admin tokens, webhook secrets, API keys, or raw New API error bodies.
