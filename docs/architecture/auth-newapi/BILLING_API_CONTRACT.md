# Billing API Contract

## Scope

B11 exposes a sandbox-only billing backend. It does not enable real payment, real funds, production domains, or production payment credentials.

The project order store is the payment truth source. New API remains the only cloud quota ledger.

## Routes

| Route | Method | Purpose | Auth |
| --- | --- | --- | --- |
| `/api/billing/config` | `GET` | Return enabled sandbox payment channel configuration. | Public read. |
| `/api/billing/orders` | `POST` | Create an authenticated sandbox recharge order. | B09 session plus CSRF. |
| `/api/billing/orders/[id]` | `GET` | Read the current user's order. | B09 session. |
| `/api/billing/webhooks/sandbox` | `POST` | Receive sandbox provider callback. | HMAC webhook signature, no user session. |

## Payment Configuration

`GET /api/billing/config` returns:

```json
{
  "ok": true,
  "channels": [
    {
      "channel": "sandbox_alipay",
      "name": "Sandbox Alipay",
      "display_color": "#1677ff",
      "min_amount": 500,
      "fixed_amounts": [500, 1000, 3000, 5000, 10000],
      "custom_amount_range": {
        "min_amount": 500,
        "max_amount": 200000
      },
      "discounts": [
        {
          "threshold_amount": 3000,
          "multiplier_basis_points": 10500
        }
      ],
      "currency": "CNY",
      "enabled": true,
      "sort_order": 10,
      "estimated_quota_units_per_minor_unit": 10
    }
  ]
}
```

Amounts are minor currency units. For CNY, `500` means CNY 5.00.

Future frontend work must render channels from this response and must not hard-code payment channels, fixed amounts, discounts, or colors.

## Create Order

Request:

```json
{
  "channel": "sandbox_alipay",
  "currency": "CNY",
  "requestedAmount": 1000,
  "idempotencyKey": "checkout:local-task-or-cart-id"
}
```

Server rules:

- session decides `local_user_id`;
- B08 mapping must be `active`;
- channel must be enabled;
- amount must match fixed amount or custom range;
- discount and credited quota are calculated server-side;
- idempotency key prevents duplicate orders;
- response never includes webhook secret or New API credentials.

Success:

```json
{
  "ok": true,
  "order": {
    "order_id": "bo_uuid",
    "local_user_id": "local-user",
    "new_api_user_id": "100",
    "channel": "sandbox_alipay",
    "currency": "CNY",
    "requested_amount": 1000,
    "paid_amount": 0,
    "credited_quota": 10000,
    "status": "pending",
    "idempotency_key": "checkout:local-task-or-cart-id",
    "provider_order_id": "sandbox_bo_uuid",
    "created_at": "2026-06-18T00:00:00.000Z",
    "updated_at": "2026-06-18T00:00:00.000Z",
    "paid_at": null,
    "last_error": null,
    "version": 1
  },
  "payment": {
    "channel": "sandbox_alipay",
    "provider_order_id": "sandbox_bo_uuid",
    "sandbox_webhook_path": "/api/billing/webhooks/sandbox"
  }
}
```

## Read Order

`GET /api/billing/orders/[id]` returns only the authenticated user's own order. Other users receive `payment_not_found`.

## Runtime Data

Runtime orders are stored in ignored local data at `data/billing-store.json`.

This is the local payment order truth source for the sandbox. It is not a cloud quota balance.
