# Production Payment Checklist

This checklist records future production conditions only. B11 does not enable real payment.

## Provider Readiness

- Select real provider and complete legal/compliance review.
- Use provider sandbox certification before production keys.
- Store provider secrets in managed secret storage, not `.env` committed files.
- Rotate webhook secrets before launch.
- Confirm TLS and public callback domain.
- Confirm provider IP allowlist or signature policy.
- Confirm refund and dispute policy.

## Security

- Non-empty webhook secret is mandatory.
- Verify raw-body signatures before parsing.
- Enforce timestamp and replay protection.
- Keep raw signatures, secrets, cookies, Authorization headers, and payment keys out of logs.
- Treat payment logs as sensitive operational data.
- Add alerting for repeated webhook failures and review orders.

## New API Quota Credit

- Reconfirm official New API quota adjustment endpoint for the pinned release.
- Verify quota credit idempotency with real New API test container.
- Decide whether quota adjustments use additive top-up or absolute quota update.
- Record New API response IDs or audit evidence.
- Verify B10 quota cache invalidation or fresh read after credit.
- Verify restore/rollback does not double-credit orders.

## Order Store

- Replace JSON repository with the approved durable database migration when shared schema ownership allows it.
- Add unique constraints for `order_id`, `provider_order_id`, and `(local_user_id, idempotency_key)`.
- Add transaction boundary for order update and quota credit evidence.
- Add retention and PII policy.
- Add admin repair UI or approved internal script.

## Operational Checks

- Load test order creation and webhook concurrency.
- Run backup/restore rehearsal for local orders and New API quota state.
- Run reconciliation on a restored environment before enabling checkout.
- Confirm monitoring for `review`, `quota_credit_failed`, and webhook reject spikes.

## Launch Gate

Production payment must not launch until:

- all checks above are complete;
- no real key is present in the repo;
- no test/sandbox label remains ambiguous;
- B12 security review confirms one payment order truth source and one cloud quota ledger;
- a separate approved task explicitly enables production payment.
