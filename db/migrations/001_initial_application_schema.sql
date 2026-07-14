-- Application database baseline for the Auth/New API backend line.
-- This schema is for the project application database only.
-- Do not point these migrations at the New API service database.

create table if not exists schema_migrations (
  version text primary key,
  checksum text not null,
  applied_at timestamptz not null default now()
);

create table if not exists app_users (
  local_user_id uuid primary key,
  email text not null,
  username text not null,
  display_name text not null,
  password_hash text not null,
  status text not null,
  role text not null,
  session_version integer not null default 1,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  last_login_at timestamptz,
  version integer not null default 1,
  constraint app_users_email_unique unique (email),
  constraint app_users_username_unique unique (username),
  constraint app_users_status_check check (status in ('active', 'disabled', 'verification_required')),
  constraint app_users_role_check check (role in ('user', 'admin')),
  constraint app_users_session_version_check check (session_version > 0),
  constraint app_users_version_check check (version > 0),
  constraint app_users_password_hash_not_plain_check check (password_hash like 'scrypt$%')
);

create table if not exists auth_sessions (
  session_id uuid primary key,
  local_user_id uuid not null references app_users(local_user_id) on delete cascade,
  token_hash text not null,
  session_version integer not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  last_seen_at timestamptz not null,
  idle_expires_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  user_agent_hash text,
  ip_hash text,
  version integer not null default 1,
  constraint auth_sessions_token_hash_unique unique (token_hash),
  constraint auth_sessions_token_hash_not_raw_check check (length(token_hash) >= 32),
  constraint auth_sessions_version_check check (version > 0),
  constraint auth_sessions_session_version_check check (session_version > 0),
  constraint auth_sessions_expiry_order_check check (idle_expires_at <= expires_at)
);

create table if not exists new_api_user_mappings (
  local_user_id uuid primary key references app_users(local_user_id) on delete cascade,
  new_api_user_id text,
  sync_status text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  last_sync_at timestamptz,
  last_error_code text,
  last_error_message text,
  retry_count integer not null default 0,
  version integer not null default 1,
  idempotency_key text not null,
  constraint new_api_user_mappings_local_unique unique (local_user_id),
  constraint new_api_user_mappings_new_api_unique unique (new_api_user_id),
  constraint new_api_user_mappings_idempotency_unique unique (idempotency_key),
  constraint new_api_user_mappings_status_check check (
    sync_status in ('pending', 'active', 'failed', 'disabled', 'orphaned', 'repair_required')
  ),
  constraint new_api_user_mappings_retry_count_check check (retry_count >= 0),
  constraint new_api_user_mappings_version_check check (version > 0),
  constraint new_api_user_mappings_active_requires_user_check check (
    sync_status <> 'active' or new_api_user_id is not null
  )
);

create table if not exists billing_orders (
  order_id text primary key,
  local_user_id uuid not null references app_users(local_user_id) on delete restrict,
  new_api_user_id text not null,
  channel text not null,
  currency text not null,
  requested_amount integer not null,
  paid_amount integer not null default 0,
  credited_quota integer not null,
  status text not null,
  idempotency_key text not null,
  provider_order_id text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  paid_at timestamptz,
  last_error text,
  version integer not null default 1,
  quota_credit_applied_at timestamptz,
  refunded_at timestamptz,
  constraint billing_orders_user_idempotency_unique unique (local_user_id, idempotency_key),
  constraint billing_orders_provider_order_unique unique (provider_order_id),
  constraint billing_orders_currency_check check (currency in ('CNY')),
  constraint billing_orders_amount_check check (requested_amount > 0 and paid_amount >= 0 and credited_quota >= 0),
  constraint billing_orders_status_check check (
    status in ('pending', 'processing', 'paid', 'failed', 'cancelled', 'review', 'refunded')
  ),
  constraint billing_orders_version_check check (version > 0)
);

create table if not exists billing_webhook_events (
  event_id text primary key,
  order_id text not null references billing_orders(order_id) on delete cascade,
  provider_order_id text not null,
  event_type text not null,
  received_at timestamptz not null default now(),
  occurred_at timestamptz,
  payload_hash text not null,
  status text not null,
  safe_error text,
  constraint billing_webhook_events_status_check check (status in ('accepted', 'duplicate', 'rejected', 'review')),
  constraint billing_webhook_events_type_check check (
    event_type in ('payment_succeeded', 'payment_failed', 'payment_cancelled', 'payment_refunded')
  )
);

create table if not exists billing_idempotency_keys (
  key_id uuid primary key,
  local_user_id uuid not null references app_users(local_user_id) on delete cascade,
  idempotency_key text not null,
  scope text not null,
  order_id text references billing_orders(order_id) on delete set null,
  request_hash text,
  response_hash text,
  created_at timestamptz not null,
  expires_at timestamptz,
  constraint billing_idempotency_keys_unique unique (local_user_id, scope, idempotency_key)
);

create table if not exists usage_records (
  id uuid primary key,
  local_user_id uuid not null references app_users(local_user_id) on delete cascade,
  new_api_user_id text,
  task_id text not null,
  operation text not null,
  status text not null,
  estimated_quota_units integer not null,
  actual_quota_units integer,
  upstream_log_id text,
  upstream_request_id text,
  upstream_model text,
  upstream_created_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  idempotency_key text not null,
  error_code text,
  error_message text,
  version integer not null default 1,
  constraint usage_records_idempotency_unique unique (idempotency_key),
  constraint usage_records_user_task_unique unique (local_user_id, task_id),
  constraint usage_records_operation_check check (
    operation in ('cloud_image_generation', 'cloud_video_generation', 'cloud_image_upscale', 'cloud_video_upscale')
  ),
  constraint usage_records_status_check check (
    status in ('prechecked', 'accepted', 'succeeded', 'failed', 'cancelled', 'refunded', 'reconciliation_required')
  ),
  constraint usage_records_quota_units_check check (
    estimated_quota_units >= 0 and (actual_quota_units is null or actual_quota_units >= 0)
  ),
  constraint usage_records_version_check check (version > 0)
);

create table if not exists task_billing_records (
  id uuid primary key,
  local_user_id uuid not null references app_users(local_user_id) on delete cascade,
  task_id text not null,
  usage_record_id uuid references usage_records(id) on delete set null,
  idempotency_key text not null,
  billing_state text not null,
  estimated_quota_units integer not null,
  final_quota_units integer,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  version integer not null default 1,
  constraint task_billing_records_idempotency_unique unique (idempotency_key),
  constraint task_billing_records_user_task_unique unique (local_user_id, task_id),
  constraint task_billing_records_state_check check (
    billing_state in ('prechecked', 'accepted', 'settled', 'failed', 'cancelled', 'reconciliation_required')
  ),
  constraint task_billing_records_quota_units_check check (
    estimated_quota_units >= 0 and (final_quota_units is null or final_quota_units >= 0)
  ),
  constraint task_billing_records_version_check check (version > 0)
);

create table if not exists audit_events (
  id uuid primary key,
  event text not null,
  local_user_id uuid references app_users(local_user_id) on delete set null,
  created_at timestamptz not null,
  request_id text,
  ip_hash text,
  user_agent_hash text,
  safe_details jsonb not null default '{}'::jsonb,
  constraint audit_events_safe_details_object_check check (jsonb_typeof(safe_details) = 'object')
);

create table if not exists reconciliation_runs (
  run_id uuid primary key,
  scope text not null,
  status text not null,
  started_at timestamptz not null,
  finished_at timestamptz,
  checked_count integer not null default 0,
  issue_count integer not null default 0,
  safe_summary jsonb not null default '{}'::jsonb,
  constraint reconciliation_runs_status_check check (status in ('running', 'completed', 'failed', 'review_required')),
  constraint reconciliation_runs_count_check check (checked_count >= 0 and issue_count >= 0),
  constraint reconciliation_runs_safe_summary_object_check check (jsonb_typeof(safe_summary) = 'object')
);

create index if not exists app_users_status_idx on app_users(status);
create index if not exists auth_sessions_local_user_id_idx on auth_sessions(local_user_id);
create index if not exists auth_sessions_active_expiry_idx
  on auth_sessions(local_user_id, idle_expires_at, expires_at)
  where revoked_at is null;
create index if not exists new_api_user_mappings_status_idx on new_api_user_mappings(sync_status);
create index if not exists billing_orders_local_user_created_idx on billing_orders(local_user_id, created_at desc);
create index if not exists billing_orders_status_updated_idx on billing_orders(status, updated_at desc);
create index if not exists billing_webhook_events_order_idx on billing_webhook_events(order_id, received_at desc);
create index if not exists billing_idempotency_keys_expiry_idx on billing_idempotency_keys(expires_at);
create index if not exists usage_records_user_created_idx on usage_records(local_user_id, created_at desc);
create index if not exists usage_records_upstream_log_idx on usage_records(upstream_log_id);
create index if not exists task_billing_records_user_updated_idx on task_billing_records(local_user_id, updated_at desc);
create index if not exists audit_events_user_created_idx on audit_events(local_user_id, created_at desc);
create index if not exists audit_events_event_created_idx on audit_events(event, created_at desc);
create index if not exists reconciliation_runs_scope_started_idx on reconciliation_runs(scope, started_at desc);
