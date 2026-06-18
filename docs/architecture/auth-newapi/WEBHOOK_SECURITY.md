# Webhook Security

## Sandbox Signature

B11 sandbox webhooks require:

- non-empty `PAYMENT_SANDBOX_WEBHOOK_SECRET`;
- `X-Payment-Timestamp`;
- `X-Payment-Signature`;
- HMAC-SHA256 over `timestamp.rawBody`;
- five-minute timestamp tolerance;
- event ID idempotency.

Empty secret disables the sandbox webhook path.

## Verification Order

1. Read raw request body.
2. Reject when the sandbox secret is empty.
3. Verify timestamp format.
4. Reject delayed or future callbacks outside the tolerance window.
5. Verify HMAC using constant-time comparison.
6. Parse JSON only after signature passes.
7. Validate order ID and provider order ID.
8. Validate local user ID, New API user ID, channel, amount, and currency.
9. Apply legal state transition.
10. Credit New API quota only once.

## Required Payload

```json
{
  "event_id": "evt-uuid",
  "event_type": "payment_succeeded",
  "order_id": "bo_uuid",
  "provider_order_id": "sandbox_bo_uuid",
  "local_user_id": "local-user",
  "new_api_user_id": "100",
  "channel": "sandbox_alipay",
  "currency": "CNY",
  "paid_amount": 1000,
  "occurred_at": "2026-06-18T00:01:00.000Z"
}
```

Supported event types:

- `payment_succeeded`
- `payment_failed`
- `payment_cancelled`
- `payment_refunded`

## Tamper Handling

| Tamper type | Result |
| --- | --- |
| Bad signature | Reject; order unchanged. |
| Empty secret | Reject; webhook disabled. |
| Replay timestamp | Reject; order unchanged. |
| Duplicate event ID | Return idempotent success; no second credit. |
| Amount mismatch | Mark `review`; no credit. |
| User mismatch | Mark `review`; no credit. |
| Currency mismatch | Mark `review`; no credit. |
| Channel mismatch | Mark `review`; no credit. |
| Out-of-order paid after cancelled/failed | Mark `review`; no credit. |

## Logging

Audit records may include order ID, event type, safe error class, request ID, amount, and credited quota.

Audit records must not include:

- webhook secret;
- payment provider secret;
- raw signature;
- session token;
- cookie;
- Authorization header;
- New API admin token;
- password;
- raw provider body with secrets.
