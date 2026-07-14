alter table billing_orders
  add column if not exists product_type text not null default 'credits',
  add column if not exists product_plan_id text,
  add column if not exists product_cycle text;

alter table billing_orders
  drop constraint if exists billing_orders_product_type_check;

alter table billing_orders
  add constraint billing_orders_product_type_check
  check (product_type in ('credits', 'membership'));

alter table billing_orders
  drop constraint if exists billing_orders_product_membership_check;

alter table billing_orders
  add constraint billing_orders_product_membership_check
  check (
    (product_type = 'credits' and product_plan_id is null and product_cycle is null)
    or
    (product_type = 'membership' and product_plan_id is not null and product_cycle in ('monthly', 'quarterly', 'yearly'))
  );

create table if not exists user_memberships (
  id uuid primary key,
  local_user_id uuid not null references app_users(local_user_id) on delete cascade,
  plan_id text not null,
  cycle text not null,
  status text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  source_order_id text not null references billing_orders(order_id) on delete restrict,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  cancelled_at timestamptz,
  version integer not null default 1,
  constraint user_memberships_plan_check check (plan_id in ('basic', 'advanced', 'pro', 'enterprise')),
  constraint user_memberships_cycle_check check (cycle in ('monthly', 'quarterly', 'yearly')),
  constraint user_memberships_status_check check (status in ('active', 'queued', 'cancelled', 'expired')),
  constraint user_memberships_time_check check (ends_at > starts_at),
  constraint user_memberships_version_check check (version > 0),
  constraint user_memberships_order_unique unique (source_order_id)
);

create table if not exists membership_entitlements (
  id uuid primary key,
  local_user_id uuid not null references app_users(local_user_id) on delete cascade,
  kind text not null,
  granted integer not null,
  used integer not null default 0,
  remaining integer not null,
  source_order_id text not null references billing_orders(order_id) on delete restrict,
  expires_at timestamptz not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  version integer not null default 1,
  constraint membership_entitlements_kind_check check (kind in ('prompt_optimize', 'image_generation', 'video_generation')),
  constraint membership_entitlements_amount_check check (granted >= 0 and used >= 0 and remaining >= 0 and granted = used + remaining),
  constraint membership_entitlements_version_check check (version > 0)
);

create table if not exists membership_entitlement_ledger (
  id uuid primary key,
  local_user_id uuid not null references app_users(local_user_id) on delete cascade,
  kind text not null,
  delta integer not null,
  idempotency_key text not null,
  source_order_id text references billing_orders(order_id) on delete set null,
  task_id text,
  created_at timestamptz not null,
  constraint membership_entitlement_ledger_kind_check check (kind in ('prompt_optimize', 'image_generation', 'video_generation')),
  constraint membership_entitlement_ledger_delta_check check (delta <> 0),
  constraint membership_entitlement_ledger_unique unique (local_user_id, idempotency_key)
);

create index if not exists user_memberships_user_status_idx on user_memberships(local_user_id, status, starts_at, ends_at);
create index if not exists user_memberships_order_idx on user_memberships(source_order_id);
create index if not exists membership_entitlements_user_kind_expiry_idx on membership_entitlements(local_user_id, kind, expires_at);
create index if not exists membership_entitlement_ledger_task_idx on membership_entitlement_ledger(local_user_id, task_id) where task_id is not null;

alter table task_billing_records
  add column if not exists membership_entitlement_kind text,
  add column if not exists membership_entitlement_units integer not null default 0;

alter table task_billing_records
  drop constraint if exists task_billing_records_membership_entitlement_check;

alter table task_billing_records
  add constraint task_billing_records_membership_entitlement_check
  check (
    (membership_entitlement_kind is null and membership_entitlement_units = 0)
    or
    (
      membership_entitlement_kind in ('image_generation', 'video_generation')
      and membership_entitlement_units > 0
    )
  );

alter table usage_records
  drop constraint if exists usage_records_operation_check;

alter table usage_records
  add constraint usage_records_operation_check
  check (
    operation in ('cloud_image_generation', 'cloud_video_generation', 'cloud_image_upscale', 'cloud_video_upscale', 'prompt_optimize')
  );
