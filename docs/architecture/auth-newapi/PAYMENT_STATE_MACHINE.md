# Payment State Machine

## States

| State | Meaning |
| --- | --- |
| `pending` | Order was created and is waiting for sandbox payment confirmation. |
| `processing` | Verified paid callback is being settled into New API quota. |
| `paid` | Payment was verified and New API quota credit was applied once. |
| `failed` | Sandbox provider reported failure before credit. |
| `cancelled` | Sandbox provider reported cancellation before credit. |
| `review` | Automatic handling is unsafe or incomplete; operator/reconciliation must inspect. |
| `refunded` | Sandbox refund event was verified and recorded. |

## Legal Transitions

| From | To |
| --- | --- |
| `pending` | `processing`, `cancelled`, `failed`, `review` |
| `processing` | `paid`, `failed`, `cancelled`, `review` |
| `paid` | `refunded`, `review` |
| `failed` | `review` |
| `cancelled` | `review` |
| `review` | `processing`, `paid`, `failed`, `cancelled`, `refunded` |
| `refunded` | `review` |

Repeated verified paid callbacks for an already credited order are idempotent and keep the order `paid`.

## Settlement Boundary

`paid` means both:

- sandbox payment has been verified; and
- New API quota credit succeeded once for the mapped `new_api_user_id`.

If payment is verified but quota credit fails, the order enters `review`. It must not be shown as fully paid.

## Refund Boundary

B11 records sandbox `refunded` status after a verified refund webhook. It does not subtract a local balance and does not invent a negative ledger. Production refund policy must decide whether to adjust New API quota, freeze usage, or require manual review.

## Forbidden Transitions

- `pending -> paid` without passing through quota settlement.
- `cancelled -> paid` automatically.
- `failed -> paid` automatically.
- Any state -> `paid` when New API quota credit failed.
- Any duplicate webhook that credits quota twice.
