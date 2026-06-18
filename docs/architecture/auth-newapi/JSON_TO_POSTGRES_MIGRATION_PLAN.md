# JSON To PostgreSQL Migration Plan

BP-01A only establishes the database baseline. It does not migrate runtime data, remove JSON storage, enable dual-write, or make PostgreSQL the primary write path.

## Phase 1: Schema Creation

- Apply `db/migrations/001_initial_application_schema.sql` to an empty application PostgreSQL database.
- Set `APP_DATABASE_EXPECTED_NAME` and verify `select current_database()` matches it before any DDL.
- Apply `db/migrations/001_initial_application_schema.sql` and `db/migrations/002_harden_database_baseline.sql`.
- Verify `schema_migrations` has the expected checksums for both migrations.
- Confirm the target database is the application database, not the New API database.
- Confirm no local table represents a second New API quota balance ledger.

## Phase 2: Read-Only Validation

- Build JSON readers that load existing `data/auth-store.json`, `data/new-api-user-mappings.json`, `data/billing-store.json`, and `data/quota-usage-log.json` without writing.
- Validate field shapes against the PostgreSQL target schema.
- Report missing fields, invalid timestamps, invalid statuses, invalid integer amount/quota units, invalid session hashes, and duplicate identifiers.
- Do not modify JSON files in this phase.

## Phase 3: One-Time Data Import

- Import users into `app_users` by `local_user_id`.
- Import sessions into `auth_sessions` after rejecting raw or too-short token values.
- Import mappings into `new_api_user_mappings` with the existing status, retry count, and sanitized error fields.
- Import billing orders into `billing_orders`.
- Import processed webhook event IDs into `billing_webhook_events` when enough event data exists; otherwise preserve evidence in order audit rows and mark gaps for review.
- Import usage entries into `usage_records`.
- Import auth and billing audit entries into `audit_events`.
- Record the import run and counts in a reconciliation artifact.

## Phase 4: Dual-Write Window

- Not enabled in BP-01A.
- A later module may write both JSON and PostgreSQL only behind an explicit feature flag.
- Dual-write failures must be visible and repairable; they must not silently fall back to JSON for billable state.
- Idempotency keys must be reused across JSON and PostgreSQL writes.

## Phase 5: Consistency Comparison

- Compare per-store counts between JSON and PostgreSQL.
- Compare hashes of normalized records by stable IDs.
- Verify duplicate users, duplicate mappings, duplicate orders, and duplicate webhook events are rejected by PostgreSQL constraints.
- Verify imported usage records can be paged by `local_user_id` and task ID.
- Verify payment and quota evidence does not create or imply a local balance ledger.

## Phase 6: PostgreSQL Primary Write

- Switch one repository at a time to PostgreSQL primary writes after phase 5 passes.
- Preserve existing API response contracts.
- Keep JSON fallback read-only during the first production window.
- Fail closed for ambiguous billing, mapping, and quota states.

## Phase 7: JSON Degraded Read-Only

- Stop JSON writes for migrated domains.
- Keep JSON files as read-only emergency evidence for a bounded retention window.
- Block writes if PostgreSQL is unavailable instead of writing divergent JSON state for auth, orders, mappings, or usage.

## Phase 8: Stop JSON Writes

- Remove JSON repository construction from production paths only after PostgreSQL primary writes are stable.
- Keep tests for migration import and rollback.
- Ensure session cleanup, order reconciliation, and audit writing all use PostgreSQL.

## Phase 9: Backup

- Back up PostgreSQL before each migration cutover.
- Back up JSON files before import and before disabling JSON writes.
- Store checksums for source JSON and database dumps.
- Do not commit backups, database dumps, `.env`, logs, or runtime files.

## Phase 10: Final Old-Code Removal

- Remove obsolete JSON runtime repositories only after a separate reviewed module proves no production code path uses them.
- Remove JSON migration feature flags after the rollback window closes.
- Keep archival migration documentation and checksum records.

## Data Mapping Rules

| Source | Target | Notes |
| --- | --- | --- |
| `AuthUser.local_user_id` | `app_users.local_user_id` | Stable UUID/string must parse as UUID before import. |
| `AuthUser.email` | `app_users.email` | Normalize to existing auth repository rules before duplicate checks. |
| `AuthUser.username` | `app_users.username` | Must be unique. |
| `AuthUser.password_hash` | `app_users.password_hash` | Existing `scrypt$...` format is preserved; passwords are never reset in migration. |
| `AuthSession.token_hash` | `auth_sessions.token_hash` | Raw tokens are rejected; only lowercase SHA-256 hex values matching `^[a-f0-9]{64}$` are accepted. |
| `NewApiUserMapping.local_user_id` | `new_api_user_mappings.local_user_id` | Must reference an imported local user. |
| `NewApiUserMapping.new_api_user_id` | `new_api_user_mappings.new_api_user_id` | Unique when present; conflicts become manual review. |
| `BillingOrder.requested_amount` | `billing_orders.requested_amount` | Integer minor currency unit only. |
| `BillingOrder.credited_quota` | `billing_orders.credited_quota` | Recorded settlement amount; not a local balance. |
| `BillingOrder.webhook_event_ids[]` | `billing_webhook_events.event_id` | Import as event evidence only when order linkage is clear. |
| `UsageLogEntry` | `usage_records` | Retains task, upstream, estimate, final usage, and status evidence. |

## Exception Handling

- Missing fields: fill only fields with safe defaults already defined by the existing backend contract; otherwise mark the row for manual review.
- Duplicate users: keep the earliest valid record by `created_at` only after manual review; do not auto-delete.
- Duplicate mappings: active mapping conflicts become `repair_required`; do not steal New API ownership.
- Duplicate orders: preserve all evidence and mark duplicates for review; do not double-credit quota.
- Invalid sessions: reject and require login again.
- Wrong database identity: stop before creating `schema_migrations` or any application table; do not infer identity from the URL string.
- Orphan records: import only when a valid owner exists, or quarantine into an operator review report.
- Time format: parse ISO timestamps; invalid or missing timestamps are review items unless a safe source timestamp exists.
- Amount format: reject floats and strings that cannot be converted to integer minor units without loss.
- Import idempotency: every import row uses source ID plus source checksum as an idempotency key where the target table supports it.
- Rerun behavior: rerunning import updates only rows with matching source checksum and unchanged target version; conflicts stop the import.
- Rollback: restore PostgreSQL from pre-import backup and keep JSON stores as source of truth until the primary-write switch is separately approved.
- Hash verification: source file checksums and normalized row hashes are recorded before and after import.
- Dual-write compensation: if later dual-write fails after one side succeeds, the state enters repair/reconciliation instead of silent success.
