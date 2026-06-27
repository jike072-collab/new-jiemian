-- Stage 9C-A database MVP foundation.
-- This migration defines cloud/multi-user persistence tables only.
-- It does not migrate existing data/uploads content and must not be run against production without a separate release gate.

create table if not exists assets (
  id uuid primary key,
  kind text not null,
  storage_type text not null,
  path_or_url text not null,
  mime_type text,
  size_bytes bigint,
  sha256 text,
  width integer,
  height integer,
  duration_ms integer,
  created_at timestamptz not null,
  deleted_at timestamptz,
  constraint assets_kind_check check (char_length(kind) > 0),
  constraint assets_storage_type_check check (storage_type in ('local', 'object_storage', 'remote_url', 'external')),
  constraint assets_path_or_url_check check (char_length(path_or_url) > 0),
  constraint assets_size_bytes_check check (size_bytes is null or size_bytes >= 0),
  constraint assets_sha256_check check (sha256 is null or sha256 ~ '^[a-f0-9]{64}$'),
  constraint assets_width_check check (width is null or width > 0),
  constraint assets_height_check check (height is null or height > 0),
  constraint assets_duration_ms_check check (duration_ms is null or duration_ms >= 0)
);

create table if not exists generation_jobs (
  id uuid primary key,
  user_id uuid references app_users(local_user_id) on delete set null,
  kind text not null,
  status text not null,
  prompt text not null,
  input_asset_id uuid references assets(id) on delete set null,
  output_asset_id uuid references assets(id) on delete set null,
  provider text,
  provider_model text,
  request_hash text,
  error_code text,
  user_visible_error text,
  internal_error_masked text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  started_at timestamptz,
  completed_at timestamptz,
  constraint generation_jobs_kind_check check (char_length(kind) > 0),
  constraint generation_jobs_status_check check (status in ('queued', 'running', 'succeeded', 'failed', 'canceled')),
  constraint generation_jobs_request_hash_check check (request_hash is null or request_hash ~ '^[a-f0-9]{64}$'),
  constraint generation_jobs_timestamps_check check (
    updated_at >= created_at
    and (started_at is null or started_at >= created_at)
    and (completed_at is null or completed_at >= created_at)
  )
);

create table if not exists library_items (
  id uuid primary key,
  asset_id uuid not null references assets(id) on delete restrict,
  generation_job_id uuid references generation_jobs(id) on delete set null,
  user_id uuid references app_users(local_user_id) on delete set null,
  title text,
  kind text not null,
  source text not null,
  is_deleted boolean not null default false,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  constraint library_items_kind_check check (char_length(kind) > 0),
  constraint library_items_source_check check (source in ('upload', 'generation', 'import', 'system')),
  constraint library_items_deleted_check check (
    (is_deleted = false and deleted_at is null)
    or (is_deleted = true and deleted_at is not null)
  ),
  constraint library_items_timestamps_check check (updated_at >= created_at)
);

create table if not exists provider_model_snapshots (
  id uuid primary key,
  provider text not null,
  model_id text not null,
  display_name text,
  capability text not null,
  raw_response_masked jsonb,
  checked_at timestamptz not null,
  created_at timestamptz not null,
  constraint provider_model_snapshots_provider_check check (char_length(provider) > 0),
  constraint provider_model_snapshots_model_id_check check (char_length(model_id) > 0),
  constraint provider_model_snapshots_capability_check check (char_length(capability) > 0),
  constraint provider_model_snapshots_raw_response_object_check check (
    raw_response_masked is null or jsonb_typeof(raw_response_masked) in ('object', 'array')
  )
);

create table if not exists api_call_logs (
  id uuid primary key,
  provider text not null,
  endpoint_kind text not null,
  generation_job_id uuid references generation_jobs(id) on delete set null,
  status text not null,
  latency_ms integer,
  request_id text,
  error_code text,
  error_masked text,
  created_at timestamptz not null,
  constraint api_call_logs_provider_check check (char_length(provider) > 0),
  constraint api_call_logs_endpoint_kind_check check (char_length(endpoint_kind) > 0),
  constraint api_call_logs_status_check check (char_length(status) > 0),
  constraint api_call_logs_latency_ms_check check (latency_ms is null or latency_ms >= 0)
);

create table if not exists error_events (
  id uuid primary key,
  scope text not null,
  severity text not null,
  code text,
  message_masked text not null,
  context_masked jsonb,
  created_at timestamptz not null,
  constraint error_events_scope_check check (char_length(scope) > 0),
  constraint error_events_severity_check check (severity in ('debug', 'info', 'warning', 'error', 'critical')),
  constraint error_events_message_masked_check check (char_length(message_masked) > 0),
  constraint error_events_context_object_check check (
    context_masked is null or jsonb_typeof(context_masked) in ('object', 'array')
  )
);

create table if not exists audit_logs (
  id uuid primary key,
  actor_id uuid references app_users(local_user_id) on delete set null,
  action text not null,
  target_type text,
  target_id text,
  ip_hash text,
  user_agent_hash text,
  metadata_masked jsonb,
  created_at timestamptz not null,
  constraint audit_logs_action_check check (char_length(action) > 0),
  constraint audit_logs_ip_hash_check check (ip_hash is null or char_length(ip_hash) >= 16),
  constraint audit_logs_user_agent_hash_check check (user_agent_hash is null or char_length(user_agent_hash) >= 16),
  constraint audit_logs_metadata_object_check check (
    metadata_masked is null or jsonb_typeof(metadata_masked) in ('object', 'array')
  )
);

create table if not exists quota_accounts (
  id uuid primary key,
  user_id uuid references app_users(local_user_id) on delete set null,
  balance numeric(20, 4) not null default 0,
  unit text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint quota_accounts_unit_check check (char_length(unit) > 0),
  constraint quota_accounts_timestamps_check check (updated_at >= created_at)
);

create table if not exists quota_ledger (
  id uuid primary key,
  quota_account_id uuid not null references quota_accounts(id) on delete restrict,
  direction text not null,
  amount numeric(20, 4) not null,
  reason text not null,
  generation_job_id uuid references generation_jobs(id) on delete set null,
  idempotency_key text,
  created_at timestamptz not null,
  constraint quota_ledger_direction_check check (direction in ('credit', 'debit', 'reserve', 'release', 'adjustment')),
  constraint quota_ledger_amount_check check (amount > 0),
  constraint quota_ledger_reason_check check (char_length(reason) > 0)
);

create index if not exists generation_jobs_user_created_idx on generation_jobs(user_id, created_at desc) where user_id is not null;
create index if not exists generation_jobs_status_created_idx on generation_jobs(status, created_at desc);
create index if not exists generation_jobs_kind_created_idx on generation_jobs(kind, created_at desc);
create index if not exists generation_jobs_created_idx on generation_jobs(created_at desc);
create index if not exists generation_jobs_provider_model_idx on generation_jobs(provider, provider_model, created_at desc) where provider is not null;

create index if not exists assets_kind_created_idx on assets(kind, created_at desc);
create index if not exists assets_storage_type_created_idx on assets(storage_type, created_at desc);
create index if not exists assets_sha256_idx on assets(sha256) where sha256 is not null;
create index if not exists assets_created_idx on assets(created_at desc);
create index if not exists assets_deleted_at_idx on assets(deleted_at) where deleted_at is not null;

create index if not exists library_items_user_created_idx on library_items(user_id, created_at desc) where user_id is not null;
create index if not exists library_items_asset_id_idx on library_items(asset_id);
create index if not exists library_items_generation_job_id_idx on library_items(generation_job_id) where generation_job_id is not null;
create index if not exists library_items_kind_created_idx on library_items(kind, created_at desc);
create index if not exists library_items_deleted_created_idx on library_items(is_deleted, created_at desc);

create index if not exists provider_model_snapshots_provider_model_checked_idx
  on provider_model_snapshots(provider, model_id, checked_at desc);
create index if not exists provider_model_snapshots_capability_checked_idx
  on provider_model_snapshots(capability, checked_at desc);

create index if not exists api_call_logs_provider_endpoint_created_idx
  on api_call_logs(provider, endpoint_kind, created_at desc);
create index if not exists api_call_logs_generation_job_id_idx on api_call_logs(generation_job_id) where generation_job_id is not null;
create index if not exists api_call_logs_status_created_idx on api_call_logs(status, created_at desc);
create index if not exists api_call_logs_created_idx on api_call_logs(created_at desc);

create index if not exists error_events_scope_severity_created_idx on error_events(scope, severity, created_at desc);
create index if not exists error_events_code_created_idx on error_events(code, created_at desc) where code is not null;
create index if not exists error_events_created_idx on error_events(created_at desc);

create index if not exists audit_logs_actor_created_idx on audit_logs(actor_id, created_at desc) where actor_id is not null;
create index if not exists audit_logs_action_created_idx on audit_logs(action, created_at desc);
create index if not exists audit_logs_target_idx on audit_logs(target_type, target_id) where target_type is not null;

create unique index if not exists quota_accounts_user_unique_idx on quota_accounts(user_id) where user_id is not null;
create index if not exists quota_accounts_updated_idx on quota_accounts(updated_at desc);
create index if not exists quota_ledger_account_created_idx on quota_ledger(quota_account_id, created_at desc);
create index if not exists quota_ledger_generation_job_id_idx on quota_ledger(generation_job_id) where generation_job_id is not null;
create unique index if not exists quota_ledger_account_idempotency_unique_idx
  on quota_ledger(quota_account_id, idempotency_key)
  where idempotency_key is not null;
