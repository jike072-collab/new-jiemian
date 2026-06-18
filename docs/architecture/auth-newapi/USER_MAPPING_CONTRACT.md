# User Mapping Contract

## Purpose

The mapping links one project user to one New API user. It is the only supported bridge between local identity and New API quota, usage, and token operations.

The mapping does not replace local identity. `local_user_id` remains the primary user ID for this project.

## Required Fields

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `local_user_id` | string | yes | Project user ID. Primary identity for this app. |
| `new_api_user_id` | string or null | yes | New API user ID once creation or lookup succeeds. Null while pending or failed. |
| `sync_status` | enum | yes | Mapping state. Allowed values are listed below. |
| `created_at` | timestamp | yes | Local mapping creation time. |
| `updated_at` | timestamp | yes | Last local mapping row update. |
| `last_sync_at` | timestamp or null | yes | Last successful or attempted sync time, depending on implementation detail documented in B08. |
| `last_error` | string or null | yes | Sanitized error summary. Must not contain passwords, cookies, tokens, Authorization headers, or webhook secrets. |
| `version` | integer | yes | Optimistic concurrency/version field for repair and retry workflows. |

## Status Values

| Status | Meaning | Allowed actions |
| --- | --- | --- |
| `pending` | Local user exists and New API mapping has not completed. | Allow local login. Block billable cloud actions. Retry sync. |
| `active` | Mapping is valid and New API user is enabled. | Allow quota reads and billable cloud actions subject to quota. |
| `failed` | Last sync failed and can be retried. | Allow local login. Block billable cloud actions. Retry with backoff. |
| `disabled` | User is disabled locally or mapped New API user is disabled. | Deny billable cloud actions. Session behavior follows local account policy. |
| `orphaned` | New API user exists but no longer has a valid local owner, or local user lost mapping consistency. | Block billable cloud actions. Require admin repair. |
| `repair_required` | Automatic retry is unsafe because identity, quota, or order consistency is ambiguous. | Block billable cloud actions. Require manual or privileged repair path. |

## Cardinality

- One `local_user_id` maps to at most one active `new_api_user_id`.
- One `new_api_user_id` maps to at most one `local_user_id`.
- Duplicate active mappings are blocking data integrity defects.
- Mapping repair must preserve the original `local_user_id` as the project identity.

## Sync Rules

- Registration creates the local user first.
- New API user creation or lookup happens through the BFF using server-side credentials.
- The browser never receives New API admin credentials or root credentials.
- If New API sync fails, keep the local user and mark the mapping `failed` or `pending`.
- Do not grant cloud quota or run billable cloud actions until the mapping is `active`.
- Repeated failures or conflicting New API users move the mapping to `repair_required`.

## Compensation

Registration sync failure must be compensated by retry, not by creating duplicate local users.

Expected B08/B09 behavior:

1. Create local user and local session only after local credential validation succeeds.
2. Create mapping row with `pending`.
3. Attempt New API user create/lookup.
4. On success, set `new_api_user_id`, `active`, and `last_sync_at`.
5. On retryable failure, set `failed`, sanitize `last_error`, and schedule retry.
6. On conflict or uncertain partial creation, set `repair_required`.

## Audit Requirements

- Log mapping state changes in local product audit logs.
- Do not log secrets.
- Preserve enough external IDs and timestamps to reconcile with New API logs later.
- B12 must verify that no code path creates a New API user without a local mapping record.
