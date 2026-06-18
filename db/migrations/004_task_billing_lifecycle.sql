-- Add task settlement metadata without creating a local quota balance ledger.

alter table task_billing_records
  add column if not exists new_api_task_id text,
  add column if not exists settled_at timestamptz,
  add column if not exists refunded_at timestamptz,
  add column if not exists last_error text;

create index if not exists task_billing_records_new_api_task_idx
  on task_billing_records(new_api_task_id)
  where new_api_task_id is not null;

create table if not exists task_quota_adjustments (
  id uuid primary key,
  local_user_id uuid not null references app_users(local_user_id) on delete cascade,
  new_api_user_id text not null,
  task_billing_record_id uuid references task_billing_records(id) on delete cascade,
  task_id text not null,
  idempotency_key text not null unique,
  quota_delta integer not null,
  original_quota integer,
  target_quota integer,
  status text not null,
  provider_adjustment_id text,
  last_error text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  applied_at timestamptz,
  version integer not null default 1,
  constraint task_quota_adjustments_status_check check (status in ('pending', 'applied', 'failed')),
  constraint task_quota_adjustments_version_check check (version > 0)
);

create index if not exists task_quota_adjustments_user_status_idx
  on task_quota_adjustments(new_api_user_id, status, updated_at);

create index if not exists task_quota_adjustments_task_idx
  on task_quota_adjustments(task_billing_record_id)
  where task_billing_record_id is not null;
