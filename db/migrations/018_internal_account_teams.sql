alter table app_users
  add column if not exists account_owner_id uuid references app_users(local_user_id) on delete restrict;

alter table app_users
  drop constraint if exists app_users_account_owner_not_self_check;

alter table app_users
  add constraint app_users_account_owner_not_self_check
  check (account_owner_id is null or account_owner_id <> local_user_id);

create index if not exists app_users_account_owner_idx
  on app_users(account_owner_id, created_at desc);

create index if not exists usage_records_operation_created_idx
  on usage_records(operation, created_at desc);
