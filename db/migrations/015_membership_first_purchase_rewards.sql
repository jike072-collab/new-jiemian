create table if not exists membership_first_purchase_rewards (
  local_user_id uuid primary key references app_users(local_user_id) on delete cascade,
  source_order_id text not null unique,
  plan_id text not null,
  cycle text not null,
  bonus_credits integer not null default 0,
  bonus_entitlements jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  constraint membership_first_purchase_rewards_plan_check
    check (plan_id in ('basic', 'advanced', 'pro', 'enterprise')),
  constraint membership_first_purchase_rewards_cycle_check
    check (cycle in ('monthly', 'quarterly', 'yearly')),
  constraint membership_first_purchase_rewards_credits_check check (bonus_credits >= 0),
  constraint membership_first_purchase_rewards_entitlements_check
    check (jsonb_typeof(bonus_entitlements) = 'object')
);

insert into membership_first_purchase_rewards (
  local_user_id,
  source_order_id,
  plan_id,
  cycle,
  bonus_credits,
  bonus_entitlements,
  created_at
)
select distinct on (local_user_id)
  local_user_id,
  source_order_id,
  plan_id,
  cycle,
  0,
  '{}'::jsonb,
  created_at
from user_memberships
where source_order_id not like 'admin-membership:%'
order by local_user_id, created_at asc
on conflict (local_user_id) do nothing;
