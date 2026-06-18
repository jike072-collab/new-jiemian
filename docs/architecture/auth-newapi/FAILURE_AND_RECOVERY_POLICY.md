# Failure And Recovery Policy

## Principle

When local account state and New API state disagree, preserve the local project identity and fail closed for billable cloud actions.

Do not hide uncertainty by creating duplicate users, duplicate ledgers, or fake successful payments.

## New API Unavailable

| Operation | Policy |
| --- | --- |
| Login with existing local credentials | Allowed if local auth backend is healthy and account is enabled. |
| Register local user | Allowed only if B09/B08 can record mapping `pending` or `failed` safely. |
| Billable cloud action | Blocked. Quota and mapping cannot be verified. |
| Quota display | Show unavailable or stale-marked snapshot through UI contract. |
| Payment order creation | Allowed only if B11 can clearly mark quota application as pending. |
| Payment quota application | Paused or marked repair-required until New API recovers. |

## Registration Sync Failure

- Local user remains the project identity.
- Mapping is marked `failed` for retryable errors.
- Mapping is marked `repair_required` for conflicts or uncertain partial creation.
- Billable cloud actions remain blocked until mapping becomes `active`.
- The user must not receive cloud quota while mapping is not active.

## Quota Read Or Debit Failure

- Billable cloud actions fail closed when quota cannot be verified.
- If an async task was accepted by New API but local state did not record completion, local usage log enters a reconciliation state.
- If local job storage succeeded but New API settlement is ambiguous, do not adjust a local balance. Reconcile against New API.

## Payment Failure

- Webhook verification failure does not update an order to paid.
- Paid-but-quota-not-applied remains repairable and visible to operations.
- Retry must be idempotent.
- No real payment keys or real funds are used before B11 production readiness is separately approved.

## Backup And Restore Implications

- Restore local project auth/order/usage data and New API data as a consistent pair when possible.
- If restored states disagree, run reconciliation before enabling billable actions.
- A restored local user without active New API mapping must be treated as `pending`, `failed`, or `repair_required`, not silently active.

## Blocking Conditions

Stop and repair before proceeding when any of these appear:

- two independent cloud balance ledgers;
- two customer session truth sources;
- browser-stored New API admin/root credentials;
- successful payment status without verified webhook or sandbox equivalent;
- billable customer action bypassing New API quota;
- duplicate active mapping for one local user or New API user.

## Error Recording

- Store sanitized error class, provider/request ID where safe, timestamps, and retry count.
- Never store passwords, cookies, Authorization headers, API keys, webhook secrets, or raw payment secrets in `last_error` or logs.
