# User Repair Runbook

## Purpose

This runbook is for New API mapping rows in `failed`, `orphaned`, or `repair_required`.

Do not grant quota, run billable cloud work, or mark a mapping active until the local user and New API user relationship is confirmed.

## Initial Triage

1. Read the mapping by `local_user_id`.
2. Confirm `sync_status`, `new_api_user_id`, `retry_count`, `version`, `last_error_code`, and `last_error_message`.
3. Confirm the local user exists in the future B09 local account store.
4. Query New API by expected username or email through the server-side admin client.
5. Confirm New API user status is enabled before returning to active.
6. Preserve evidence in sanitized audit logs.

## Safe Automatic Actions

Safe automatic actions:

- retry `failed` mappings when retry count is below the ceiling;
- activate a pending/failed mapping when the matching New API user is confirmed by id, username, or email;
- mark mapping `disabled` when local account or New API user is disabled;
- mark mapping `orphaned` when the local owner is missing.

Unsafe automatic actions:

- deleting New API users;
- merging two local users;
- moving quota between New API users;
- overwriting an active mapping owned by a different local user;
- treating a duplicate upstream user as active without confirmation;
- creating a second balance ledger to compensate for sync failure.

## Failed Mapping

Use when `sync_status = failed`.

1. Check `retry_count`.
2. If below limit and the error is retryable, call the retry path.
3. If New API user is found after a timeout, activate the mapping with the confirmed id.
4. If retry fails again, keep `failed` until the limit is reached.
5. If the limit is reached, move to `repair_required`.

## Duplicate Or Conflict

Use when error code is `NEW_API_USER_DUPLICATE_UNCONFIRMED` or `NEW_API_MAPPING_CONFLICT`.

1. Query New API for the username/email.
2. Check whether the returned New API user is already mapped to another `local_user_id`.
3. If another active local mapping owns the New API user, do not steal it.
4. If ownership is unclear, keep `repair_required`.
5. If ownership is confirmed and no other local mapping owns it, activate with a guarded `version`.

## Local Save Failed After Upstream Create

Use when New API user may exist but local mapping is not active.

1. Query New API by username/email.
2. If exactly one matching user exists and no other local mapping owns it, activate the original local mapping.
3. If multiple users match, keep `repair_required`.
4. If another local mapping owns the same New API user, keep `repair_required`.
5. Never delete the upstream user automatically.

## Orphaned Mapping

Use when `sync_status = orphaned`.

1. Confirm whether the local user was deleted, restored, or migrated.
2. If local user was restored and identity matches, move through repair back to active.
3. If local user is permanently gone, keep the New API user disabled or operationally quarantined according to later account policy.
4. Do not assign the New API user to a different local user without explicit migration evidence.

## Disabled Mapping

Use when `sync_status = disabled`.

1. Confirm local account status.
2. Confirm New API user status.
3. Re-enable only when both local policy and New API status allow it.
4. Preserve `local_user_id`; do not create a replacement local account as a shortcut.

## Operator Checklist

- No secrets copied into tickets or logs.
- No browser storage of New API admin credentials.
- No quota granted while mapping is not active.
- No duplicate active mapping for one local user or New API user.
- No automatic upstream deletion.
- No local cloud balance ledger created to bypass New API quota.
