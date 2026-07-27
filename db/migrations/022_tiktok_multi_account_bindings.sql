create table if not exists tiktok_account_bindings (
  user_id uuid not null references app_users(local_user_id) on delete cascade,
  zernio_credential_id text not null default 'default',
  zernio_profile_id text not null,
  zernio_account_id text not null,
  display_name text not null,
  avatar_url text,
  creator_username text,
  connected_at timestamptz not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (user_id, zernio_account_id),
  constraint tiktok_account_bindings_account_unique unique (zernio_account_id),
  constraint tiktok_account_bindings_credential_id_check check (char_length(zernio_credential_id) between 2 and 64),
  constraint tiktok_account_bindings_profile_id_check check (char_length(zernio_profile_id) between 1 and 255),
  constraint tiktok_account_bindings_account_id_check check (char_length(zernio_account_id) between 1 and 255),
  constraint tiktok_account_bindings_display_name_check check (char_length(display_name) between 1 and 255),
  constraint tiktok_account_bindings_timestamps_check check (updated_at >= created_at and connected_at >= created_at)
);

insert into tiktok_account_bindings(
  user_id, zernio_credential_id, zernio_profile_id, zernio_account_id, display_name, avatar_url, creator_username,
  connected_at, created_at, updated_at
)
select
  user_id, 'default', zernio_profile_id, zernio_account_id,
  coalesce(display_name, creator_username, 'TikTok'), avatar_url, creator_username,
  coalesce(connected_at, updated_at), created_at, updated_at
from tiktok_connections
where zernio_account_id is not null
on conflict (zernio_account_id) do nothing;

create index if not exists tiktok_account_bindings_user_connected_idx
  on tiktok_account_bindings(user_id, connected_at, zernio_account_id);

alter table tiktok_publish_jobs
  add column if not exists zernio_account_id text;

alter table tiktok_publish_jobs
  add column if not exists zernio_credential_id text not null default 'default';

update tiktok_publish_jobs jobs
set zernio_account_id = connections.zernio_account_id
from tiktok_connections connections
where jobs.user_id = connections.user_id
  and jobs.zernio_account_id is null
  and connections.zernio_account_id is not null;

alter table tiktok_publish_jobs
  drop constraint if exists tiktok_publish_jobs_account_id_check;

alter table tiktok_publish_jobs
  add constraint tiktok_publish_jobs_account_id_check
  check (zernio_account_id is null or char_length(zernio_account_id) between 1 and 255);

alter table tiktok_publish_jobs
  drop constraint if exists tiktok_publish_jobs_credential_id_check;

alter table tiktok_publish_jobs
  add constraint tiktok_publish_jobs_credential_id_check
  check (char_length(zernio_credential_id) between 2 and 64);

create index if not exists tiktok_publish_jobs_user_account_created_idx
  on tiktok_publish_jobs(user_id, zernio_account_id, created_at desc);
