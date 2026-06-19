# Payment Ledger Boundary

## Decision

The project owns the payment order truth source. New API owns the cloud quota ledger.

Payment and quota are linked through an idempotent settlement boundary:

local successful order -> BFF quota top-up operation -> New API user quota.

## Responsibilities

| Domain | Truth source | Later module |
| --- | --- | --- |
| Customer identity for payment | Project `local_user_id` | B09/B11 |
| Order creation | Project billing/order table | B11 |
| Order status | Project billing/order table | B11 |
| Webhook verification | Project payment integration | B11 |
| Cloud quota after successful payment | New API user quota | B10/B11 |
| Recharge reconciliation evidence | Project order audit plus New API quota/log evidence | B11/B12 |

## Why New API Payment Is Not The Project Order Truth Source

- This project needs product-owned user IDs, support workflows, refunds, and future payment UI contracts.
- New API payment features are real, but coupling the product order lifecycle directly to New API would make New API replacement and rollback harder.
- Keeping local order authority avoids treating a quota top-up record as the full business payment record.

## Required Order States

B11 should define explicit states at least equivalent to:

- `created`
- `pending_payment`
- `paid`
- `quota_apply_pending`
- `quota_applied`
- `failed`
- `expired`
- `refunded`
- `repair_required`

Exact names may change in B11, but the state machine must distinguish paid-but-not-applied from fully reconciled.

## Idempotency

- Every payment provider callback must be idempotent.
- Every New API quota application must use a stable local order ID or idempotency key where supported.
- Retrying a webhook or repair job must not double-credit quota.
- Reconciliation must compare local order amount, mapped user, expected quota delta, and New API result.

## Refunds

- Refund state is local payment truth.
- If refunded quota was already applied, B11 must define whether to subtract quota, freeze account actions, or mark manual review.
- Refund handling must not create a second negative-balance ledger outside New API.

## Sandbox Boundary

- B11 may use payment sandbox providers only.
- Real payment keys, real funds, production domains, and production customer imports remain forbidden.
- Mock payment may be used only when clearly labeled as sandbox/mock and must not be claimed as real provider verification.
