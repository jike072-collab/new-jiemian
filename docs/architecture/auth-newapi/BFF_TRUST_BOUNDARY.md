# BFF Trust Boundary

## Decision

The BFF is the only trusted bridge between this project and New API.

Browser clients talk to this project. The project server talks to New API.

## Boundary Diagram

```text
Browser
  |
  | app session cookie, CSRF token, product API calls
  v
Project BFF
  |
  | server-side New API credentials, mapped user operations
  v
New API test/production service
  |
  | database, Redis, quota, logs, payment adapter internals
  v
New API persistence
```

## Browser May Receive

- Project session cookie only as HttpOnly cookie.
- Sanitized user/account state.
- Sanitized quota display snapshot.
- Product order status.
- Product usage history filtered by `local_user_id`.

## Browser Must Not Receive

- New API admin/root keys.
- New API session cookies.
- New API user password.
- New API access tokens unless a future module explicitly creates a user-facing token product with separate approval.
- Payment provider secrets.
- Webhook secrets.
- Database or Redis credentials.

## BFF Responsibilities

- Verify local session and CSRF before mutations.
- Resolve `local_user_id` to an active New API mapping.
- Perform New API user, quota, log, token, and payment-settlement calls server-to-server.
- Sanitize errors before returning them to the browser.
- Enforce fail-closed behavior for billable cloud actions.
- Keep idempotency keys for order-to-quota settlement.

## New API Responsibilities

- Own cloud quota ledger for mapped users.
- Execute or proxy billable model requests.
- Store its own operational logs and settlement evidence.
- Enforce its own admin/root protections.
- Run migrations and maintain its own database.

## Network And Secret Boundary

- New API should be reachable from the BFF network path, not from arbitrary public clients in test deployments unless explicitly needed.
- Database and Redis remain internal and must not expose public ports.
- Secrets live in environment or secret storage, not committed files.
- Logs must not include passwords, cookies, Authorization headers, API keys, payment secrets, or webhook secrets.

## Later Module Hooks

- B05 deploys New API in an isolated test environment.
- B07 implements the BFF client against this boundary.
- B08 implements mapping operations.
- B09 implements local auth/session APIs.
- B10 implements quota and usage gates.
- B11 implements order and payment sandbox settlement.
- B12 verifies the trust boundary end to end.
