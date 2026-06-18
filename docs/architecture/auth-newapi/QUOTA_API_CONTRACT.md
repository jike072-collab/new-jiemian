# Quota API Contract

## Scope

B10 exposes backend quota and usage contracts for authenticated project users. It does not modify the workbench UI or generation routes.

New API remains the only cloud quota ledger. The local service may cache quota for display and may record usage audit events, but those records are not a balance authority.

## Units

| Field | Meaning |
| --- | --- |
| `quota_units` | Raw New API `quota` value. |
| `used_quota_units` | Raw New API `used_quota` value. |
| `available_quota_units` | `quota_units - used_quota_units`, clamped to zero for display and precheck comparison. |
| `display_unit` | `credits` until a reviewed product conversion exists. |

B10 does not introduce RMB, points, or token conversion. Future display conversion must be documented before use.

## Routes

| Route | Method | Purpose | CSRF |
| --- | --- | --- | --- |
| `/api/quota` | `GET` | Read current user's quota snapshot. | No |
| `/api/quota/precheck` | `POST` | Fail-closed quota precheck for a future billable cloud task. | Yes |
| `/api/usage` | `GET` | Read current user's local audit usage or upstream New API log view. | No |

## `GET /api/quota`

Success:

```json
{
  "ok": true,
  "quota": {
    "local_user_id": "local-user-id",
    "new_api_user_id": "100",
    "quota_units": 1000,
    "used_quota_units": 250,
    "available_quota_units": 750,
    "display_unit": "credits",
    "source": "new_api",
    "fetched_at": "2026-06-18T00:00:00.000Z",
    "cached": false,
    "cache_expires_at": "2026-06-18T00:00:15.000Z"
  }
}
```

Rules:

- A short display cache is allowed.
- Cache hits set `cached: true`.
- Cache is not an authorization source for high-cost work.
- Mapping states other than `active` return `mapping_pending`.
- New API failures return a stable quota error code, not raw upstream text.

## `POST /api/quota/precheck`

Request:

```json
{
  "taskId": "future-task-id",
  "idempotencyKey": "quota-precheck:future-task-id",
  "operation": "cloud_image_generation",
  "estimatedQuotaUnits": 25
}
```

Supported `operation` values:

| Value | Meaning |
| --- | --- |
| `cloud_image_generation` | Cloud image generation through the BFF/New API path. |
| `cloud_video_generation` | Cloud video generation through the BFF/New API path. |
| `cloud_image_upscale` | Cloud image upscale through the BFF/New API path. |
| `cloud_video_upscale` | Cloud video upscale through the BFF/New API path. |

Success:

```json
{
  "ok": true,
  "quota": {},
  "estimatedQuotaUnits": 25,
  "usage": {
    "task_id": "future-task-id",
    "status": "prechecked",
    "estimated_quota_units": 25,
    "actual_quota_units": null
  }
}
```

Rules:

- The route requires the B09 project HttpOnly session and CSRF token.
- The browser never sends New API credentials.
- The precheck always reads fresh New API quota.
- The precheck writes a local audit entry, not a debit.
- Repeated calls with the same `idempotencyKey` update the same audit entry.
- Invalid operation, task ID, idempotency key, or estimate returns `invalid_quota_request`.
- Insufficient New API quota returns `insufficient_quota` and records a failed audit entry without charging.

## `GET /api/usage`

Query:

| Parameter | Default | Meaning |
| --- | --- | --- |
| `page` | `1` | Positive page number. |
| `pageSize` | `20` | Clamped to `1..100`. |
| `source` | `local` | `local` reads project audit logs; `upstream` reads New API logs through admin BFF credentials. |

Success:

```json
{
  "ok": true,
  "usage": {
    "entries": [],
    "page": 1,
    "pageSize": 20,
    "total": 0
  }
}
```

Rules:

- Results are scoped by the authenticated `local_user_id`.
- Local logs are filtered by `local_user_id`.
- Upstream logs are requested only for the active mapped `new_api_user_id`.
- Other users' records must not be returned.
- Upstream log shape is normalized into the product usage entry contract.

## Admin Read-Only Contract

B10 does not add an admin UI. Future backend/admin screens may use server-side read-only quota and usage queries after project admin session verification.

Admin query rules:

- Use project admin role from B09/B12, not New API browser session.
- Do not expose New API admin token, cookies, base URL internals, or raw upstream errors.
- Do not mutate quota from B10 admin reads.
- Recharge and adjustment flows belong to B11.
