# Database Persistence Audit

BP-01A audited the current server-side persistence before adding the PostgreSQL baseline. Runtime JSON stores remain active in this module. No data is migrated and no primary write path is switched to PostgreSQL in BP-01A.

## Current Persistence

| Current data | Current storage location | Write module | Read module | Concurrency risk | Loss risk | Target table | Migration priority |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Users | `data/auth-store.json` through `src/lib/server/auth/repository.ts` | `StoreAuthRepository.createUser`; constructed by `createJsonAuthRepository` | `StoreAuthRepository.getUserById`, `StoreAuthRepository.getUserByIdentifier` | Process-local queue serializes writes only inside one Node process. Multiple processes can race on the same JSON file. | Local runtime file can be lost with disk cleanup, failed volume mount, or non-atomic cross-volume rename. | `app_users` | P0 |
| Session | `data/auth-store.json` through `src/lib/server/auth/repository.ts` | `StoreAuthRepository.createSession`, `StoreAuthRepository.touchSession`, `StoreAuthRepository.revokeSession` | `StoreAuthRepository.getSessionByTokenHash` | Same process-local queue risk; no database row lock for concurrent refresh/logout. | Lost JSON invalidates active sessions; stale JSON can keep revoked sessions if write is lost. | `auth_sessions` | P0 |
| New API user mapping | `data/new-api-user-mappings.json` through `src/lib/server/integrations/new-api/user-mapping.ts` | `NewApiUserMappingStoreRepository.createPending`, `markActive`, `markFailed`, `markDisabled`, `markOrphaned`, `scheduleRepair`, `prepareRetry`; constructed by `createJsonNewApiUserMappingRepository` | `getByLocalUserId`, `getByNewApiUserId`, `listByStatus` | Process-local queue cannot enforce global uniqueness across app instances. | Mapping loss can orphan New API users or block quota/payment actions until repair. | `new_api_user_mappings` | P0 |
| Recharge orders | `data/billing-store.json` through `src/lib/server/billing/repository.ts` | `StoreBillingRepository.createOrder`, `updateOrder`; constructed by `createJsonBillingRepository` | `getOrder`, `getOrderByIdempotencyKey`, `getOrderByProviderOrderId`, `listOrders` | JSON queue cannot guarantee cross-process idempotency for duplicate order creation. | Order loss breaks support, reconciliation, and payment proof. | `billing_orders` | P0 |
| Webhook events | `data/billing-store.json` stores processed event IDs inside order records | `StoreBillingRepository.appendWebhookEvent` | `StoreBillingRepository.getOrder`, `listOrders` | Duplicate webhook races can pass in separate app processes before JSON write completes. | Event history is partial; losing it can cause manual review or duplicate-processing risk. | `billing_webhook_events` | P0 |
| Idempotency records | `data/billing-store.json` order idempotency key and provider order ID fields | `StoreBillingRepository.createOrder` | `getOrderByIdempotencyKey`, `getOrderByProviderOrderId` | No database unique constraint; protection is in-memory plus JSON scan. | Lost record can allow duplicate order creation. | `billing_idempotency_keys` | P0 |
| Usage records | `data/quota-usage-log.json` through `src/lib/server/quota/repository.ts` | `StoreUsageLogRepository.record`; constructed by `createJsonUsageLogRepository` | `listForUser`, `getByTaskId` | Process-local queue cannot protect idempotent task writes across app instances. | Usage audit loss harms support and quota reconciliation, but does not create a local balance ledger. | `usage_records` and `task_billing_records` | P1 |
| Quota cache/snapshot | In-memory `Map` in `src/lib/server/quota/cache.ts` | `QuotaDisplayCache.set`, `invalidate`, `clear` | `QuotaDisplayCache.get` | Per-process cache can diverge briefly and is intentionally not authoritative. | Cache loss is acceptable; next read fetches New API quota again. | None; cache remains ephemeral | P3 |
| Audit logs | `data/auth-store.json` and `data/billing-store.json` | `StoreAuthRepository.appendAudit`; `StoreBillingRepository.appendAudit` | `listAuditEvents` in each repository | Per-file queues only; cross-module audit ordering is not guaranteed. | Lost audit rows reduce forensic evidence and support traceability. | `audit_events` | P1 |
| Reconciliation results | `scripts/reconcile-billing-sandbox.mjs` reads `data/billing-store.json` and prints results | No persistent write in BP-01A; script reports issues from `reconcile()` | `readBillingStore` in `scripts/reconcile-billing-sandbox.mjs` | No durable run record; concurrent reconciliation is operator-controlled. | Console-only result can be lost unless captured externally. | `reconciliation_runs` | P2 |

## Boundary Findings

- Application data is stored under ignored runtime `data/` files today. BP-01A does not delete or replace those files.
- New API remains accessed through the BFF/API boundary. The application database baseline must not read or write New API internal tables.
- New API quota is still the only cloud quota ledger. `usage_records` and `task_billing_records` are audit and settlement evidence, not a mutable local balance.
- `QuotaDisplayCache` is intentionally in memory and must not become a second quota ledger during migration.
- The first PostgreSQL migration defines constraints that JSON cannot enforce reliably across processes: unique users, session token hashes, user mappings, order idempotency, webhook event IDs, and usage/task idempotency.

## BP-01A Non-Changes

- No existing API route response contract is changed.
- No JSON repository is removed.
- No dual-write path is enabled.
- No production payment path is enabled.
- No A-side UI/workbench file is changed.
