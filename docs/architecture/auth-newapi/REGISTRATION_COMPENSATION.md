# Registration Compensation

## Boundary

The current repository still has no formal database transaction manager. B09 uses the existing runtime JSON persistence pattern and defines the transaction boundary explicitly:

1. Validate request and password strength.
2. Check duplicate local email and username.
3. Create the local project account with hashed password.
4. Call B08 `NewApiUserSyncService.ensureMapped()` with stable `local_user_id`.
5. If mapping is active, create a project session and return `success`.
6. If mapping is `failed`, `pending`, or `repair_required`, keep the local account and return `mapping_pending`.
7. If mapping cannot be safely recorded at all, mark local account `verification_required` and return `service_unavailable`.

The local account is never deleted automatically after an uncertain New API result. This avoids deleting the only project identity while an upstream user may already exist.

## Idempotency

Mapping sync uses:

```text
register:<local_user_id>
```

as the B08 idempotency key.

## Failure Policy

| Failure | Local account | Session | Billable cloud action |
| --- | --- | --- | --- |
| New API mapping active | active | created | allowed later by B10 quota gate |
| Retryable New API failure | active | created | blocked until mapping active |
| Unconfirmed duplicate upstream user | active or verification required | created only when mapping state is recorded | blocked |
| Mapping cannot be recorded | verification required | not created | blocked |
| Duplicate local user | unchanged | not created | blocked |

## Manual Repair

Operations must use the B08 repair runbook to reconcile `failed` or `repair_required` mappings. B09 does not delete New API users, move quota, or create a second balance ledger.

## Password Handling

The submitted password is used only to create a local scrypt password hash and derive a deterministic seed for the B08 upstream generated password. The raw password is not logged, stored, or sent to the browser.
