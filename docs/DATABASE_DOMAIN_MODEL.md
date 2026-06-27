# Database Domain Model

Stage 9A proposes the future business database model. This document is design
only. It does not authorize schema changes, migrations, production writes,
provider calls, NewAPI calls, payment calls, or generation smoke tests.

## Design Principles

- Keep PostgreSQL as the application database.
- Keep object bytes in uploads or future object storage; store metadata in DB.
- Store secrets encrypted or outside DB; never send secrets to the browser.
- Store prompt/provider response content only when there is a product need and a
  retention policy.
- Use append-only ledgers for quota and payment-sensitive events.
- Prefer soft deletion for user-visible objects; hard deletion requires file and
  DB reconciliation.
- Separate internal diagnostic data from user-visible errors.
- Use idempotency keys for provider calls, billing, payment callbacks, and admin
  actions that can be retried.

## Table Summary

| Area | MVP | Can Defer | Primary Key | Key Relationships |
| --- | --- | --- | --- | --- |
| users | yes | no | `local_user_id uuid` | owns sessions, jobs, library, quota |
| auth_accounts | yes | if current password auth stays in `users` | `auth_account_id uuid` | belongs to user |
| sessions | yes | no | `session_id uuid` | belongs to user |
| providers | yes | no | `provider_id text` | has models, jobs, calls |
| provider_models | yes | no | `provider_model_id uuid` | belongs to provider |
| generation_jobs | yes | no | `job_id uuid` | belongs to user/provider/model |
| image_generations | yes | can merge into jobs initially | `job_id uuid` | extends generation job |
| image_edits | yes | can merge into jobs initially | `job_id uuid` | extends generation job |
| video_generations | yes | can merge into jobs initially | `job_id uuid` | extends generation job |
| upscale_jobs | yes | can merge into jobs initially | `job_id uuid` | extends generation job |
| assets | yes | no | `asset_id uuid` | file metadata and ownership |
| library_items | yes | no | `library_item_id uuid` | points to output assets |
| quota_accounts | yes before paid usage | can defer until quota feature | `quota_account_id uuid` | belongs to user |
| quota_ledger | yes before paid usage | no for paid usage | `ledger_id uuid` | belongs to quota account/job/order |
| orders | yes before payment | can defer until payment | `order_id text` | belongs to user |
| payments | yes before payment | can defer until payment | `payment_id uuid` | belongs to order |
| api_call_logs | yes | no | `api_call_id uuid` | links to provider/job |
| error_events | yes | no | `error_event_id uuid` | links to request/job/user |
| audit_logs | yes | no | `audit_log_id uuid` | links to admin/user |
| system_settings | can defer | yes | `setting_key text` | global config |
| deleted_items | yes | no | `deleted_item_id uuid` | references entity |
| file_storage_objects | yes | no | `storage_object_id uuid` | physical storage metadata |
| webhooks/payment_callbacks | yes before payment | can defer until payment | `callback_id uuid` | belongs to order/payment |
| admin_actions | yes | no | `admin_action_id uuid` | belongs to admin actor |
| login_events | yes | can defer for MVP | `login_event_id uuid` | belongs to user/session |

## Core Tables

### users

- MVP: yes
- Core fields: `local_user_id`, `email`, `username`, `display_name`,
  `password_hash`, `status`, `role`, `session_version`, timestamps, `version`
- Primary key: `local_user_id`
- Unique: `email`, `username`
- Indexes: `status`, `role`, `created_at`
- Statuses: `active`, `disabled`, `verification_required`, `deleted`
- Timestamps: `created_at`, `updated_at`, `deleted_at`
- Not plaintext: password, reset tokens, session tokens
- Redacted display: email may be masked in admin audit exports
- Never frontend bundle: password hash, internal version, security metadata
- Audit fields: status/role changes, session version increments

### auth_accounts and sessions

- MVP: sessions yes; auth_accounts can defer if password auth remains on users
- Core fields:
  - `auth_accounts`: provider, provider_subject, local_user_id, verified_at
  - `sessions`: token_hash, user id, session_version, last_seen, expiry, revoked
- Primary keys: `auth_account_id`, `session_id`
- Foreign keys: both reference users
- Unique: `(provider, provider_subject)`, `token_hash`
- Not plaintext: raw session tokens, OAuth tokens, cookies
- Audit: login, logout, token refresh, revocation

### providers

- MVP: yes
- Core fields: `provider_id`, `kind`, `title`, `role`, `endpoint_type`,
  `api_base_url`, `enabled`, `custom`, `secret_ref`, `encrypted_secret`,
  `key_version`, `last_rotated_at`, timestamps
- Primary key: `provider_id`
- Unique: provider id; optional `(kind, title)` for custom providers
- Indexes: `kind`, `enabled`, `endpoint_type`
- Not plaintext: API key, access key pair, provider tokens
- Redacted display: configured boolean and masked suffix only
- Never frontend bundle: encrypted secret, raw URL if internal, headers
- Audit: create/update/disable/key rotation

### provider_models

- MVP: yes
- Core fields: `provider_model_id`, `provider_id`, `model`, `display_name`,
  `capability`, `status`, `source`, `last_checked_at`, `metadata_safe`
- Primary key: `provider_model_id`
- Foreign key: provider
- Unique: `(provider_id, model, capability)`
- Indexes: capability/status
- Safe to persist: public model names, public display names, static capability
- Not safe: raw provider response, headers, keys

### generation_jobs

- MVP: yes
- Core fields: `job_id`, `local_user_id`, `job_type`, `status`, `provider_id`,
  `provider_model_id`, `idempotency_key`, `request_hash`, `prompt_ref`,
  `safe_prompt_preview`, `input_asset_ids`, `output_asset_ids`,
  `estimated_quota_units`, `actual_quota_units`, `retry_count`,
  `external_request_id`, timestamps
- Primary key: `job_id`
- Foreign keys: user, provider, model
- Unique: `(local_user_id, idempotency_key)`
- Indexes: `(local_user_id, created_at desc)`, status, job_type, provider
- Statuses: `queued`, `running`, `succeeded`, `failed`, `canceled`, `refunded`
- Not plaintext by default: full prompt, provider request, provider response
- Store references: prompt hash, prompt encrypted blob id, provider response hash
- Audit: status transitions, quota holds, admin retries

### image_generations, image_edits, video_generations, upscale_jobs

These can be detail tables keyed by `job_id`, or they can be JSONB detail columns
on `generation_jobs` for the first MVP. Detail tables become useful when query
patterns diverge.

- `image_generations`: dimensions, style, seed, count, output asset ids
- `image_edits`: input image asset ids, mask asset id, edit mode
- `video_generations`: duration, aspect ratio, reference asset ids
- `upscale_jobs`: source asset id, scale factor, target resolution, polling ids
- Not plaintext: full prompt when sensitive, provider raw response
- Never logs: provider payloads, signed URLs, authorization headers

### assets

- MVP: yes
- Core fields: `asset_id`, `owner_user_id`, `asset_type`, `source_type`,
  `storage_object_id`, `mime_type`, `size_bytes`, `sha256`, `width`, `height`,
  `duration_ms`, `status`, timestamps, `deleted_at`
- Primary key: `asset_id`
- Foreign keys: owner user, storage object
- Unique: optional `(sha256, size_bytes)` for dedupe if product allows
- Indexes: owner/date, type/status, checksum
- Statuses: `available`, `processing`, `failed`, `soft_deleted`, `purged`
- DB stores metadata only; bytes stay in uploads/object storage

### file_storage_objects

- MVP: yes
- Core fields: `storage_object_id`, `storage_backend`, `bucket`, `object_key`,
  `local_path`, `public_url`, `signed_url_supported`, `mime_type`,
  `size_bytes`, `sha256`, `created_at`, `deleted_at`
- Primary key: `storage_object_id`
- Unique: `(storage_backend, object_key)` when object storage exists
- Never frontend bundle: local absolute path, internal bucket credentials
- Public URL: store only safe public or application-routed URL
- Object key: reserve now so local uploads can migrate to object storage later

### library_items

- MVP: yes
- Core fields: `library_item_id`, `owner_user_id`, `title`, `mode`,
  `primary_asset_id`, `source_job_id`, `provider_id`, `provider_model_id`,
  `status`, `visibility`, `safe_prompt_preview`, `params_safe`, timestamps,
  `deleted_at`
- Primary key: `library_item_id`
- Foreign keys: owner user, primary asset, generation job, provider, model
- Indexes: owner/date, mode/status, deleted_at, search vector later
- Unique: none initially; optional user title slug later
- Statuses: `ready`, `processing`, `failed`, `soft_deleted`
- Relationship: one library item has one primary asset and can reference related
  assets through a join table if needed

## Quota, Orders, And Payment

### quota_accounts

- MVP: needed before paid quota
- Core fields: `quota_account_id`, `local_user_id`, `currency`,
  `current_available_units`, `status`, timestamps, `version`
- Primary key: `quota_account_id`
- Unique: `(local_user_id, currency)`
- Note: keep a cached balance only as a projection of `quota_ledger`, not as the
  only source of truth.

### quota_ledger

- MVP: yes before paid usage
- Core fields: `ledger_id`, `quota_account_id`, `local_user_id`, `entry_type`,
  `delta_units`, `balance_after`, `source_type`, `source_id`,
  `idempotency_key`, `created_at`, `safe_note`
- Primary key: `ledger_id`
- Unique: `idempotency_key`
- Indexes: account/date, source, entry type
- Entry types: `topup`, `hold`, `capture`, `release`, `refund`,
  `admin_adjustment`, `reconciliation`
- Why not only one balance field: balances need auditability, retry safety,
  refunds, reconciliation, and proof that duplicate billing did not happen.

### orders, payments, webhooks

- MVP: defer until real payment stage
- Orders fields: order id, user, channel, amount, currency, status,
  idempotency key, provider order id, quota units, timestamps
- Payments fields: payment id, order id, provider, provider transaction id,
  status, amount, paid/refunded timestamps
- Webhooks fields: callback id, order/payment id, provider event id,
  payload hash, signature status, processing status, safe error
- Unique: provider order id, provider event id, idempotency key
- Audit: every manual review, refund, status override
- Sensitive: raw callback payload should not be stored unless encrypted and
  retention-approved; store hash and safe summary instead.

## Logs And Audit

### api_call_logs

- MVP: yes
- Core fields: `api_call_id`, `job_id`, `provider_id`, `provider_model_id`,
  `operation`, `method`, `endpoint_safe`, `status_code`, `duration_ms`,
  `retry_count`, `external_request_id`, `request_hash`, `response_hash`,
  `safe_error_code`, timestamps
- Do not store: Authorization, Cookie, API keys, raw request body, raw response
- Store references or hashes for prompt/provider payloads.

### error_events

- MVP: yes
- Core fields: `error_event_id`, `request_id`, `job_id`, `local_user_id`,
  `category`, `code`, `retryable`, `user_message`, `internal_safe_details`,
  `created_at`
- Split user-visible error from internal diagnostic details.
- Redact database URLs, provider secrets, headers, cookies, prompt, and raw
  provider responses.

### audit_logs and admin_actions

- MVP: yes
- Core fields: actor, target type/id, action, request id, IP hash,
  user-agent hash, safe details, result, timestamp
- Admin actions can be a dedicated table or a typed subset of audit logs.
- Audit role/status changes, provider changes, quota adjustments, order reviews,
  refund operations, and deletion/purge actions.

### login_events

- MVP: useful but can defer after basic auth stability
- Fields: user, event, result, IP hash, user-agent hash, request id, timestamp
- Never store raw IP or user-agent if policy requires hashing.

## Deleted Items

`deleted_items` should track soft deletion and purge coordination:

- entity type/id
- owner user
- deletion requested by
- deletion reason
- `deleted_at`
- `purge_after`
- `purged_at`
- safe snapshot of metadata

Soft deletion hides objects from normal queries. Hard deletion removes database
records and files only after a reconciliation-safe purge step.

## Library And Asset Modeling Details

Current state:

- library metadata comes from `data/library.json`
- output bytes live in `uploads/`
- `count=6` comes from the library JSON item count
- there is no database table for library items today

Recommended model:

- `assets` stores logical media metadata
- `file_storage_objects` stores local path/object-storage metadata
- `library_items` stores user-facing cards
- `generation_jobs` stores lifecycle and provider relationship

Original images, generated images, videos, thumbnails, and upscale results should
all be assets. A library item points to a primary asset and can reference related
assets through `library_item_assets` later if needed.

File paths:

- store relative local names, not absolute paths
- store object keys when object storage is introduced
- store public URLs only when they are application-routed or safe permanent URLs
- signed URLs should be generated on demand, not stored as durable values

Deletion consistency:

1. mark DB rows soft-deleted
2. enqueue or run file purge with idempotency key
3. mark storage object purged only after file deletion succeeds
4. reconcile missing file vs DB metadata as a repair job

Rollback consistency:

- backup database and uploads together
- record manifest snapshots for both
- restore database and files from the same backup set
- run post-restore reconciliation counts before reopening production

Search, filtering, pagination:

- index owner, type, mode, status, created_at
- add full-text search on title/safe prompt preview later
- support cursor pagination on `(created_at, library_item_id)`

Single-admin to multi-user migration:

- create an owner for existing library items
- default current single-user records to the initial admin user or a system owner
- do not expose ownerless library records after multi-user auth is enforced

## Generation Jobs And API Calls

Use one `generation_jobs` table for image generation, image edit, video
generation, image upscale, and video upscale. Distinguish jobs with `job_type`:

- `image_generation`
- `image_edit`
- `video_generation`
- `image_upscale`
- `video_upscale`

Each job references:

- user
- provider
- provider model
- input assets
- output assets
- API call logs
- quota ledger entries

Prompt storage:

- default to hash plus safe preview
- full prompt requires retention approval and encryption or restricted access
- prompts must not appear in ordinary logs

Provider response storage:

- do not store raw response by default
- store safe summary, provider request id, hashes, and status
- store encrypted raw response only for explicitly approved debugging windows

Cost and quota:

- estimate before dispatch
- hold quota with an idempotency key
- capture actual quota on success
- release/refund on failure/cancel
- prove no duplicate charge with unique idempotency keys and ledger source ids

## Sensitive Field Rules

Never store plaintext:

- API keys
- provider tokens
- database passwords
- session tokens
- payment secrets
- webhook signing secrets

Never send to frontend bundle:

- encrypted secrets
- raw provider endpoints if internal
- database URLs
- password hashes
- raw prompts when private
- provider request/response payloads

Never log:

- Authorization
- Cookie
- API Key
- database connection string
- provider raw response
- full prompt
- payment callback raw body when it includes personal or provider secrets

Needs audit:

- role/status changes
- provider key rotation
- admin quota adjustments
- payment review/refund
- purge/hard delete
- migration execution
- production release and rollback
