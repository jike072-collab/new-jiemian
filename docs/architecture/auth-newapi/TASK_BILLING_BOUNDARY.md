# Task Billing Boundary

## Current B10 Boundary

B10 adds quota reads, usage reads, and a fail-closed precheck. It does not modify the workbench, generation, upscale, job polling, library, or file routes.

Future task submission must call the B10 quota service before starting a billable cloud task. B10 must not be interpreted as a completed workbench billing integration.

## Billable And Non-Billable Work

| Work type | New API quota |
| --- | --- |
| Cloud image generation through BFF/New API | Billable. |
| Cloud video generation through BFF/New API | Billable. |
| Cloud image upscale through BFF/New API | Billable. |
| Cloud video upscale through BFF/New API | Billable. |
| Local image HD processing with no cloud provider call | Not billable against New API quota. |
| Local video HD processing with no cloud provider call | Not billable against New API quota. |
| Preview, UI state, local library read, file read | Not billable against New API quota. |

Provider calls that bypass New API must not remain on customer billable paths after task integration. They would bypass the single cloud quota ledger.

## Future Task Flow

1. The browser submits a task request using the project session and CSRF token.
2. The task API resolves `local_user_id` from the B09 session.
3. The task API creates or reserves a project `task_id` and `idempotency_key`.
4. The task API calls B10 precheck with operation and estimated raw New API units.
5. If precheck fails, the task is not submitted upstream.
6. If precheck succeeds, the task API submits the upstream work through the server-side BFF path.
7. The task API updates local usage status to `accepted`.
8. On completion or callback, the task API records final `actual_quota_units`, upstream references, and status.
9. Reconciliation jobs compare local task entries with New API logs.

## Outcome Rules

| Event | Required behavior |
| --- | --- |
| Submit before precheck | Forbidden for billable cloud paths. |
| Precheck success | Record `prechecked`; do not locally debit quota. |
| Precheck insufficient quota | Return `insufficient_quota`; record failed audit entry; do not call upstream. |
| New API unavailable before submit | Return `quota_unavailable` or `upstream_unavailable`; fail closed. |
| Upstream accepted | Record `accepted` with upstream request/task reference when available. |
| Upstream success | Record `succeeded` and actual usage from upstream evidence. |
| Upstream failure | Record `failed`; determine whether New API pre-consumed and refunded by upstream logs. |
| User cancellation | Record `cancelled`; reconcile upstream quota state. |
| Retry | Reuse or link idempotency keys so duplicate local or upstream records are detectable. |
| Duplicate callback | Must be idempotent. Do not double-count. |
| Ambiguous timeout | Query upstream before retrying; if still ambiguous, mark `reconciliation_required`. |
| Confirmed overcharge/refund | Record evidence; New API remains the ledger. |

## Failure Task Charging

B10 does not decide that every failed task is free or charged. The final truth is New API usage and quota behavior:

- If New API did not consume quota, the local audit entry remains failed with `actual_quota_units: null` or `0`.
- If New API consumed quota for a failed task, the local audit entry records the confirmed `actual_quota_units`.
- If New API later refunds or adjusts, the local audit entry records `refunded` or reconciliation evidence.
- The local app must not invent a refund by increasing a local balance.

## Caching Rule

The display cache may support responsive UI, but task submission must not use a stale cached balance to authorize expensive work.

Precheck currently forces a fresh New API quota read. After usage records change, B10 invalidates the display cache for that local user.
