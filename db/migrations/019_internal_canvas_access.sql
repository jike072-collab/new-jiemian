create table if not exists internal_canvas_access (
  local_user_id uuid primary key references app_users(local_user_id) on delete cascade,
  access_role text not null default 'member',
  enabled boolean not null default true,
  granted_by uuid references app_users(local_user_id) on delete set null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint internal_canvas_access_role_check check (access_role in ('owner', 'member')),
  constraint internal_canvas_access_timestamps_check check (updated_at >= created_at)
);

create unique index if not exists internal_canvas_single_owner_idx
  on internal_canvas_access(access_role)
  where access_role = 'owner' and enabled = true;

create index if not exists internal_canvas_access_enabled_updated_idx
  on internal_canvas_access(enabled, updated_at desc);

update internal_canvas_access
set access_role = 'member', enabled = false, updated_at = now()
where access_role = 'owner' and enabled = true;

insert into internal_canvas_access(local_user_id, access_role, enabled, granted_by, created_at, updated_at)
select u.local_user_id, 'owner', true, u.local_user_id, now(), now()
from app_users u
where lower(u.email) = '2411897106@qq.com' and u.status = 'active'
on conflict (local_user_id) do update
  set access_role = 'owner', enabled = true, granted_by = excluded.granted_by, updated_at = excluded.updated_at;
