# Quota Source Of Truth

## Decision

New API user quota is the only cloud quota ledger.

The project may keep local usage logs, cached display snapshots, and order records, but it must not create a second independent cloud balance ledger.

## Scope

| Usage type | Deduct New API cloud quota? | Reason |
| --- | --- | --- |
| Cloud AI generation through New API/BFF | Yes | New API is the cloud quota ledger and settlement path. |
| Cloud upscale through New API/BFF | Yes | Same billable cloud execution path. |
| Local image HD processing that does not call New API or an upstream cloud provider | No | It is local compute/storage, not New API cloud quota. |
| Local video HD processing that does not call New API or an upstream cloud provider | No | It is local compute/storage, not New API cloud quota. |
| Local preview, draft, or UI-only operation | No | No cloud AI/API usage is consumed. |
| Provider calls bypassing New API | Not allowed for billable customer paths after B10 | Would bypass the single cloud quota ledger. |

## Display And Cache

- The UI may display a cached quota snapshot, but the cache is not a ledger.
- Billable actions must verify fresh enough quota with the BFF before starting.
- A stale display balance cannot authorize a charge.

## Quota Read Failure

If quota cannot be read from New API:

- billable cloud actions fail closed;
- the user sees a retry/degraded state through the future UI contract;
- local login and non-billable local features can continue;
- no local fallback balance is decremented;
- the failure is logged without secrets.

## Debit Failure

If New API pre-consume, settlement, or async task accounting fails:

- the BFF must not invent a local debit as the final balance;
- the local usage log records the attempted action and reconciliation state;
- user-facing result depends on whether New API accepted the task;
- ambiguous outcomes become repair or reconciliation work, not silent success.

## Recharge Application

- Successful local payment order settlement in B11 applies quota to the mapped New API user.
- Until New API quota application succeeds, the order is not considered fully reconciled.
- If payment succeeds but quota application fails, the order remains in a repairable state and must not be re-applied without idempotency checks.

## Invariants

- There is exactly one cloud quota ledger: New API.
- Local product usage logs are audit and reconciliation records, not balance authority.
- Local order records are payment authority, not cloud quota authority.
- No customer cloud action may bypass the BFF quota gate once B10 is implemented.
