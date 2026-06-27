# Database MVP Foundation

Stage 9C-A adds the first database foundation for cloud storage, multi-user ownership, long-lived library records, generation job tracking, provider model snapshots, API call diagnostics, safe error events, audit records, and quota placeholders.

This stage does not migrate the existing JSON or filesystem library. Current API endpoints, request fields, response fields, UI, and Chinese copy remain unchanged.

## Tables

### `generation_jobs`

Tracks generation and upscale job lifecycle records.

Fields:

- `id`: primary key.
- `user_id`: nullable owner, references `app_users(local_user_id)`.
- `kind`: job category such as image, image edit, video, or upscale.
- `status`: one of `queued`, `running`, `succeeded`, `failed`, `canceled`.
- `prompt`: prompt or safe task text captured for future traceability.
- `input_asset_id`: nullable reference to `assets`.
- `output_asset_id`: nullable reference to `assets`.
- `provider`: nullable provider key.
- `provider_model`: nullable model id.
- `request_hash`: nullable hash for idempotency or duplicate detection.
- `error_code`: nullable safe error code.
- `user_visible_error`: nullable redacted user-facing error.
- `internal_error_masked`: nullable redacted internal error detail.
- `created_at`, `updated_at`, `started_at`, `completed_at`: lifecycle timestamps.

Indexes cover user, status, kind, creation time, provider, and model queries.

### `assets`

Tracks uploaded files and generated media without moving current files.

Fields include `id`, `kind`, `storage_type`, `path_or_url`, optional `mime_type`, `size_bytes`, `sha256`, `width`, `height`, `duration_ms`, `created_at`, and nullable `deleted_at`.

Indexes cover kind, storage type, checksum, creation time, and deletion state.

### `library_items`

Tracks library entries as a relationship between assets, jobs, and users.

Fields include `id`, `asset_id`, nullable `generation_job_id`, nullable `user_id`, nullable `title`, `kind`, `source`, `is_deleted`, `created_at`, `updated_at`, and nullable `deleted_at`.

`asset_id` is required. `generation_job_id` is nullable because uploads and imports do not always start from a generation job.

### `provider_model_snapshots`

Stores model availability snapshots without secrets.

Fields include `id`, `provider`, `model_id`, nullable `display_name`, `capability`, nullable `raw_response_masked`, `checked_at`, and `created_at`.

`raw_response_masked` must already be redacted before insert.

### `api_call_logs`

Stores safe API call diagnostics.

Fields include `id`, `provider`, `endpoint_kind`, nullable `generation_job_id`, `status`, nullable `latency_ms`, nullable `request_id`, nullable `error_code`, nullable `error_masked`, and `created_at`.

This table must not store API keys, Authorization headers, cookies, provider secrets, or raw database URLs.

### `error_events`

Stores redacted application error events.

Fields include `id`, `scope`, `severity`, nullable `code`, `message_masked`, nullable `context_masked`, and `created_at`.

### `audit_logs`

Reserves system and admin audit records.

Fields include `id`, nullable `actor_id`, `action`, nullable `target_type`, nullable `target_id`, nullable `ip_hash`, nullable `user_agent_hash`, nullable `metadata_masked`, and `created_at`.

### `quota_accounts`

Reserves a quota balance surface for later stages. Stage 9C-A does not implement real payment, real orders, or real balance deduction.

Fields include `id`, nullable `user_id`, `balance`, `unit`, `created_at`, and `updated_at`.

### `quota_ledger`

Reserves a quota ledger surface for later stages.

Fields include `id`, `quota_account_id`, `direction`, `amount`, `reason`, nullable `generation_job_id`, nullable `idempotency_key`, and `created_at`.

`quota_ledger` uses a partial unique index on `(quota_account_id, idempotency_key)` when `idempotency_key` is present.

## Relationships

- `generation_jobs.user_id` references `app_users`.
- `generation_jobs.input_asset_id` and `generation_jobs.output_asset_id` reference `assets`.
- `library_items.asset_id` references `assets`.
- `library_items.generation_job_id` references `generation_jobs`.
- `library_items.user_id` references `app_users`.
- `api_call_logs.generation_job_id` references `generation_jobs`.
- `audit_logs.actor_id` references `app_users`.
- `quota_accounts.user_id` references `app_users`.
- `quota_ledger.quota_account_id` references `quota_accounts`.
- `quota_ledger.generation_job_id` references `generation_jobs`.

## Repository Layer

Stage 9C-A adds `src/lib/server/database/mvp-repositories.ts` with Postgres repository methods for:

- assets
- generation jobs
- library items
- provider model snapshots
- API call logs
- error events

The repository is not wired into current API routes by default. Existing JSON and filesystem behavior remains active until a later authorized migration stage.

## MVP Scope

In scope:

- Additive raw SQL migration.
- Safe repository foundation.
- Static schema checks.
- Mock repository tests.
- Temporary test database migration checks when explicitly configured.
- Documentation for backup, restore, migration, and cloud readiness.

Out of scope:

- Production migration.
- Staging migration by default.
- Data/uploads migration.
- Existing library cutover.
- New API endpoint behavior.
- UI changes.
- Real payment.
- Real orders.
- Real quota deduction.
- Provider secret storage.
- Server, domain, HTTPS, reverse proxy, or firewall changes.
