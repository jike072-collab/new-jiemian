# Reconciliation Runbook

## Goal

Reconciliation finds orders where payment state and quota credit state may disagree. It must repair conservatively and never blindly refund or double-credit.

## Inputs

- Local order store: `data/billing-store.json`
- B08 mapping store
- New API quota state
- Payment provider status, sandbox only in B11
- Billing audit events

## Checks

| Check | Action |
| --- | --- |
| Pending order older than timeout | Mark `review`. |
| Processing order with no quota credit | Retry idempotent New API quota credit. |
| Review order with verified paid amount and no quota credit | Retry idempotent New API quota credit. |
| Provider says paid but no verified webhook completed | Keep or mark `review`; do not auto-credit without verification. |
| Provider says failed/cancelled | Mark only after verified provider evidence. |
| Provider says refunded | Record `refunded`; production policy must decide New API quota adjustment. |

## Manual Repair Evidence

Operators should record:

- order ID;
- provider order ID;
- provider status evidence;
- local user ID;
- New API user ID;
- requested and paid amount;
- expected credited quota;
- New API quota before/after where available;
- repair action and timestamp.

## Forbidden Repair

- Do not edit `data/billing-store.json` manually in production.
- Do not apply quota twice.
- Do not refund automatically without verified provider status.
- Do not create a local balance adjustment to hide New API failure.
- Do not mark `paid` unless quota credit succeeded once.

## Current B11 Implementation

The service exposes an internal `reconcile` method used by tests and future scripts/jobs. It checks timed-out `pending`/`processing`/`review` orders and retries idempotent quota credit only for paid-like orders where amount and order evidence already match.

The sandbox script is:

```bash
node scripts/reconcile-billing-sandbox.mjs --dry-run --timeout-minutes 30
```

`--dry-run` is the default and only reads `data/billing-store.json`. It reports timed-out orders and paid-like orders that would retry idempotent New API quota credit.

To repair the isolated sandbox after confirming New API test environment configuration:

```bash
node scripts/reconcile-billing-sandbox.mjs --execute --timeout-minutes 30
```

`--execute` may mark orders `review` or retry idempotent New API quota credit through the B11 service. It does not refund automatically and does not create a local balance ledger.

A production scheduler or admin repair UI is intentionally not enabled in B11.
