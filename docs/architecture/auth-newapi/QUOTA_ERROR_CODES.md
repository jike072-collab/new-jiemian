# Quota Error Codes

Quota and usage APIs return stable product error codes. Future UI must not parse New API raw messages.

| Code | HTTP | Meaning | Retry |
| --- | --- | --- | --- |
| `invalid_quota_request` | `400` | Missing/invalid task ID, idempotency key, operation, or estimate. | No, fix request. |
| `quota_unavailable` | `503` | New API quota could not be read or response shape was unusable. | Yes. |
| `insufficient_quota` | `402` | Fresh New API available quota is below the estimate. | After recharge or lower-cost task. |
| `usage_unavailable` | `503` | Upstream usage logs could not be read. | Yes. |
| `upstream_unavailable` | `503` | New API returned a network/upstream failure. | Yes. |
| `mapping_pending` | `409` | B08 user mapping is missing or not active. | After sync/repair. |
| `permission_denied` | `403` | Session is missing, expired, or not allowed for the requested resource. | Login or request proper role. |
| `rate_limited` | `429` | New API or BFF rate limit was hit. | After `retryAfterSeconds` when present. |

## Response Shape

```json
{
  "ok": false,
  "code": "quota_unavailable",
  "message": "Quota is unavailable.",
  "retryAfterSeconds": 30
}
```

`retryAfterSeconds` is optional. Messages are safe generic messages and must not contain:

- New API base URL internals;
- admin or user access tokens;
- cookies;
- passwords;
- webhook secrets;
- upstream stack traces;
- payment credentials.

## UI Guidance

| Code | Future UI state |
| --- | --- |
| `invalid_quota_request` | Show validation error and keep task unsubmitted. |
| `quota_unavailable` | Show service unavailable/degraded state. |
| `insufficient_quota` | Show recharge or lower-cost action state. |
| `usage_unavailable` | Show usage panel unavailable while leaving local session active. |
| `upstream_unavailable` | Show retryable service unavailable state. |
| `mapping_pending` | Show account setup pending/repair state. |
| `permission_denied` | Show login/session-expired or forbidden state. |
| `rate_limited` | Show wait/retry state. |
