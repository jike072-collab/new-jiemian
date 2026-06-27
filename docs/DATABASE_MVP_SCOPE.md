# Database MVP Scope

This document freezes the minimum Stage 9C database scope. It is a planning
boundary only. It does not create tables, change schema, run migrations, write
databases, migrate JSON data, call providers, call NewAPI, or publish `3106`.

## First Batch Tables Allowed For Stage 9C

Stage 9C may implement only these first-batch tables, and only after separate
authorization:

1. `generation_jobs`
2. `assets`
3. `library_items`
4. `api_call_logs`
5. `error_events`

These tables cover the current product risk: generation jobs, output assets,
library records, safe provider call metadata, and safe error diagnostics. They
do not introduce users, payments, quota charging, provider secret storage, or
admin configuration storage.

## First Batch Tables Deferred Or Forbidden

The first Stage 9C batch must not implement:

- `users`
- `sessions`
- `auth_accounts`
- `quota_accounts`
- `quota_ledger`
- `orders`
- `payments`
- provider secret storage
- `system_settings` admin configuration storage
- full `audit_logs`
- full `deleted_items`

## Reasons For Deferral

- The product does not yet have the final multi-user, payment, quota, or billing
  operating model for this stage.
- API keys should remain environment/server-only unless a later secrets design
  adds encryption, key rotation, and audit controls.
- The first database slice should protect generation jobs, assets, library
  records, safe API call metadata, and safe error events.
- Stage 9C must not affect `3106` `data/uploads`.
- Stage 9C must first validate on `3107` or a temporary database, not directly
  on `3106`.
- Existing auth/billing/quota PostgreSQL surfaces must not be mixed with this
  MVP unless a separate migration plan explicitly covers them.

## Table Drafts

### generation_jobs

- Purpose: unified durable job record for image, image edit, video, and upscale
  requests.
- Field draft: `job_id`, `owner_ref`, `job_type`, `status`, `provider_id`,
  `provider_model_id`, `idempotency_key`, `request_hash`,
  `safe_prompt_preview`, `input_asset_ids`, `output_asset_ids`, `retry_count`,
  `external_request_id`, `safe_error_code`, `created_at`, `updated_at`,
  `finished_at`, `deleted_at`.
- Primary key: `job_id`.
- Foreign keys or logical links: provider, provider model, assets, library item.
- Indexes: `(owner_ref, created_at desc)`, `status`, `job_type`, `provider_id`,
  `external_request_id`.
- Sensitive fields: prompt and provider payloads are sensitive; store hash or
  safe preview only.
- Redaction required: yes.
- Soft delete: allowed through `deleted_at`.
- Old data migration needed: deferred; Stage 9C can start with new records only.
- Can defer: no, this is core MVP.
- Stage 9C allowed: yes.

### assets

- Purpose: metadata for generated, edited, uploaded, and upscaled files while
  bytes remain in `uploads` or future object storage.
- Field draft: `asset_id`, `owner_ref`, `asset_type`, `source_type`,
  `storage_key`, `public_path`, `mime_type`, `size_bytes`, `sha256`, `width`,
  `height`, `duration_ms`, `status`, `created_at`, `updated_at`, `deleted_at`.
- Primary key: `asset_id`.
- Foreign keys or logical links: generation job and library item.
- Indexes: `(owner_ref, created_at desc)`, `asset_type`, `status`, `sha256`.
- Sensitive fields: local absolute paths and signed URLs are sensitive.
- Redaction required: yes for paths, signed URLs, and internal storage details.
- Soft delete: allowed.
- Old data migration needed: deferred; do not migrate `uploads` in Stage 9C by
  default.
- Can defer: no, asset metadata is core MVP.
- Stage 9C allowed: yes.

### library_items

- Purpose: user-visible library metadata that currently lives in JSON files.
- Field draft: `library_item_id`, `owner_ref`, `title`, `mode`,
  `primary_asset_id`, `source_job_id`, `provider_id`, `provider_model_id`,
  `status`, `visibility`, `safe_prompt_preview`, `params_safe`, `created_at`,
  `updated_at`, `deleted_at`.
- Primary key: `library_item_id`.
- Foreign keys or logical links: primary asset, source job, provider, provider
  model.
- Indexes: `(owner_ref, created_at desc)`, `mode`, `status`, `deleted_at`.
- Sensitive fields: full prompts and raw provider parameters are sensitive.
- Redaction required: yes.
- Soft delete: allowed.
- Old data migration needed: deferred; Stage 9C may implement schema and
  repository tests before moving existing JSON records.
- Can defer: no, library persistence is core MVP.
- Stage 9C allowed: yes.

### api_call_logs

- Purpose: redacted provider/API call metadata for diagnostics and cost/risk
  review without storing raw secrets or payloads.
- Field draft: `api_call_id`, `job_id`, `provider_id`, `provider_model_id`,
  `operation`, `method`, `endpoint_safe`, `status_code`, `duration_ms`,
  `retry_count`, `external_request_id`, `request_hash`, `response_hash`,
  `safe_error_code`, `created_at`.
- Primary key: `api_call_id`.
- Foreign keys or logical links: generation job, provider, provider model.
- Indexes: `job_id`, `provider_id`, `status_code`, `created_at`.
- Sensitive fields: Authorization, Cookie, API keys, raw request body, raw
  response body, full endpoint query strings.
- Redaction required: yes.
- Soft delete: usually no; retention policy should prune later.
- Old data migration needed: no.
- Can defer: no, safe call metadata is needed for diagnostics.
- Stage 9C allowed: yes.

### error_events

- Purpose: durable safe error diagnostics separated from raw logs.
- Field draft: `error_event_id`, `request_id`, `job_id`, `owner_ref`,
  `category`, `code`, `retryable`, `user_message`, `internal_safe_details`,
  `created_at`.
- Primary key: `error_event_id`.
- Foreign keys or logical links: request, job, optional owner.
- Indexes: `request_id`, `job_id`, `category`, `code`, `created_at`.
- Sensitive fields: stack traces, database URLs, provider secrets, headers,
  cookies, prompts, raw provider responses.
- Redaction required: yes.
- Soft delete: no by default; retention policy should prune later.
- Old data migration needed: no.
- Can defer: no, safe error diagnostics are core MVP.
- Stage 9C allowed: yes.

## Explicitly Out Of Scope For Stage 9C

Stage 9C must not:

- change login/session behavior
- move auth users or sessions
- add quota charging or payments
- store provider API keys in DB
- store admin system settings in DB
- implement full audit log or full recycle bin
- migrate existing `data/library.json` records without a separate data migration
  plan
- move file bytes out of `uploads`
- publish `3106`
- run real generation or live provider probes

## Stage 9C Success Boundary

A successful Stage 9C should prove only that the first-batch schema and server
repositories can work safely on a temporary or separately authorized staging DB.
Production cutover, JSON migration, and `3106` release remain separate stages.
