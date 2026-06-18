-- Add task settlement metadata without creating a local quota balance ledger.

alter table task_billing_records
  add column if not exists new_api_task_id text,
  add column if not exists settled_at timestamptz,
  add column if not exists refunded_at timestamptz,
  add column if not exists last_error text;

create index if not exists task_billing_records_new_api_task_idx
  on task_billing_records(new_api_task_id)
  where new_api_task_id is not null;
