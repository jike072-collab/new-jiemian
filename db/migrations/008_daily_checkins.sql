-- Daily check-in rewards.
-- One row per local user and Beijing-date claim.

create table if not exists daily_checkins (
  id uuid primary key,
  local_user_id uuid not null references app_users(local_user_id) on delete cascade,
  new_api_user_id text not null,
  checkin_date date not null,
  quota_delta integer not null,
  status text not null,
  provider_adjustment_id text,
  last_error text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  claimed_at timestamptz,
  version integer not null default 1,
  constraint daily_checkins_user_date_unique unique (local_user_id, checkin_date),
  constraint daily_checkins_status_check check (status in ('pending', 'credited', 'failed')),
  constraint daily_checkins_quota_delta_check check (quota_delta > 0),
  constraint daily_checkins_version_check check (version > 0),
  constraint daily_checkins_timestamps_check check (
    updated_at >= created_at
    and (claimed_at is null or claimed_at >= created_at)
  )
);

create index if not exists daily_checkins_user_created_idx on daily_checkins(local_user_id, created_at desc);
create index if not exists daily_checkins_date_status_idx on daily_checkins(checkin_date desc, status);
