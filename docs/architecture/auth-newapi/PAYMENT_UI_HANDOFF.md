# Payment UI Handoff

## Frontend Inputs

The payment UI must fetch `/api/billing/config` and render channels from the backend response.

Do not hard-code:

- channel IDs;
- channel names;
- colors;
- minimum amount;
- fixed amount buttons;
- custom amount range;
- discounts;
- currency;
- sort order.

## Create Order Flow

1. Ensure user is logged in through B09.
2. Fetch CSRF token from `/api/auth/csrf`.
3. Fetch billing config from `/api/billing/config`.
4. User chooses an enabled channel and amount.
5. Submit `POST /api/billing/orders` with CSRF.
6. Display returned order status and sandbox provider order ID.
7. Poll `GET /api/billing/orders/[id]` or wait for future event transport.

## UI States

| Backend state | UI meaning |
| --- | --- |
| `pending` | Waiting for sandbox payment callback. |
| `processing` | Payment verified; quota settlement in progress. |
| `paid` | Recharge completed. |
| `failed` | Payment failed. |
| `cancelled` | Payment cancelled. |
| `review` | Manual review or reconciliation needed. |
| `refunded` | Refund recorded. |

## Error Codes

| Code | UI behavior |
| --- | --- |
| `billing_disabled` | Hide/disable sandbox payment. |
| `invalid_billing_request` | Show validation error. |
| `payment_channel_unavailable` | Refresh config and ask user to choose another channel. |
| `mapping_pending` | Show account setup pending; do not accept payment for quota. |
| `payment_not_found` | Show not found or access denied. |
| `payment_invalid_signature` | Webhook-only operational error; not shown in customer checkout. |
| `payment_replay_detected` | Webhook-only operational error. |
| `payment_mismatch` | Show review state. |
| `payment_out_of_order` | Show review state. |
| `quota_credit_failed` | Show review/processing failed state. |
| `permission_denied` | Ask user to log in. |

## Sandbox Warning

B11 is test-only. The UI must label this as sandbox/test payment until production readiness is approved in B12 or a later payment launch task.
