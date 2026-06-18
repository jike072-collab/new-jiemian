# Usage Log Mapping

## Purpose

The project usage log is an audit and reconciliation record for product tasks. It is not the cloud quota ledger.

New API logs remain upstream settlement evidence. B10 normalizes both local audit entries and New API log rows into one read contract for future UI and admin views.

## Local Usage Entry

| Field | Source | Notes |
| --- | --- | --- |
| `id` | Local repository | Stable audit entry ID. |
| `local_user_id` | B09 session | Permission boundary for all customer reads. |
| `new_api_user_id` | B08 mapping | Null only when recording local failure before active mapping is available. |
| `task_id` | Future task layer | Required. Must not be empty. |
| `operation` | Future task layer | One of the B10 billable cloud operation values. |
| `status` | B10/task layer | `prechecked`, `accepted`, `succeeded`, `failed`, `cancelled`, `refunded`, or `reconciliation_required`. |
| `estimated_quota_units` | Precheck caller | Raw New API units estimate. |
| `actual_quota_units` | Final task settlement | Null until final consumption is known. |
| `upstream_log_id` | New API log | Optional upstream reference. |
| `upstream_request_id` | New API log/task callback | Optional upstream request reference. |
| `upstream_model` | New API log | Optional model name. |
| `upstream_created_at` | New API log | Optional upstream timestamp. |
| `idempotency_key` | Caller | Required. Repeated writes with the same key update the same audit entry. |
| `error_code` | BFF/task layer | Stable code, no secrets. |
| `error_message` | BFF/task layer | Redacted and truncated. |

## Upstream New API Log Mapping

| Product field | New API candidates |
| --- | --- |
| `id` | `upstream:<id | request_id | task_id>` |
| `task_id` | `task_id`, then `request_id`, then upstream ID |
| `actual_quota_units` | `quota` |
| `estimated_quota_units` | `quota` until a separate estimate exists |
| `upstream_log_id` | `id` |
| `upstream_request_id` | `request_id` |
| `upstream_model` | `model_name`, then `model` |
| `upstream_created_at` | `createdAt`, numeric `created_at`, or string `created_at` |

Current New API log rows do not always identify the product operation. B10 defaults normalized upstream rows to `cloud_image_generation` only for read display. Final task settlement in future modules must attach the correct operation when the local task is created.

## Status Meaning

| Status | Meaning | Balance effect |
| --- | --- | --- |
| `prechecked` | The BFF confirmed enough New API quota before submission. | No local debit. |
| `accepted` | Upstream accepted the task, but final usage is not known. | New API owns any pre-consume behavior. |
| `succeeded` | Task completed and final usage is known or reconciled. | New API remains ledger. |
| `failed` | Task failed before or after upstream interaction. | Local log only; recovery depends on upstream state. |
| `cancelled` | User/system cancelled the task. | Reconcile with New API if it pre-consumed quota. |
| `refunded` | A confirmed upstream or operator refund happened. | Evidence only; not a separate ledger. |
| `reconciliation_required` | Outcome is ambiguous or callback/logs conflict. | Operator or repair job must resolve. |

## Privacy And Safety

- Local queries filter by `local_user_id`.
- Upstream queries derive `new_api_user_id` from the active B08 mapping; users cannot request arbitrary IDs.
- Error messages are redacted for `Authorization`, bearer tokens, cookies, passwords, secrets, keys, and similar values.
- Logs must not include New API admin credentials, browser cookies, passwords, payment secrets, or webhook secrets.
