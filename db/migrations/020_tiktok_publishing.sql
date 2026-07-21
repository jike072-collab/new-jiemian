create table if not exists tiktok_connections (
  user_id uuid primary key references app_users(local_user_id) on delete cascade,
  zernio_profile_id text not null,
  zernio_account_id text,
  display_name text,
  avatar_url text,
  creator_username text,
  connected_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint tiktok_connections_profile_id_check check (char_length(zernio_profile_id) between 1 and 255),
  constraint tiktok_connections_account_id_check check (zernio_account_id is null or char_length(zernio_account_id) between 1 and 255),
  constraint tiktok_connections_display_name_check check (display_name is null or char_length(display_name) between 1 and 255),
  constraint tiktok_connections_timestamps_check check (updated_at >= created_at)
);

create unique index if not exists tiktok_connections_zernio_account_unique_idx
  on tiktok_connections(zernio_account_id)
  where zernio_account_id is not null;

create table if not exists tiktok_oauth_states (
  state_hash text primary key,
  user_id uuid not null references app_users(local_user_id) on delete cascade,
  return_to text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null,
  constraint tiktok_oauth_states_hash_check check (state_hash ~ '^[a-f0-9]{64}$'),
  constraint tiktok_oauth_states_return_to_check check (char_length(return_to) between 1 and 500),
  constraint tiktok_oauth_states_expiry_check check (expires_at > created_at)
);

create index if not exists tiktok_oauth_states_expiry_idx
  on tiktok_oauth_states(expires_at);

create table if not exists tiktok_publish_jobs (
  id uuid primary key,
  user_id uuid not null references app_users(local_user_id) on delete cascade,
  source_owner_id uuid not null references app_users(local_user_id) on delete restrict,
  library_item_id text not null,
  idempotency_key text not null,
  caption text not null default '',
  privacy_level text not null,
  disable_comment boolean not null default false,
  disable_duet boolean not null default false,
  disable_stitch boolean not null default false,
  brand_content_toggle boolean not null default false,
  brand_organic_toggle boolean not null default false,
  is_aigc boolean not null default true,
  status text not null,
  scheduled_at timestamptz not null,
  next_attempt_at timestamptz not null,
  attempts integer not null default 0,
  zernio_post_id text,
  uploaded_bytes bigint not null default 0,
  tiktok_post_id text,
  post_url text,
  error_code text,
  error_message text,
  locked_at timestamptz,
  locked_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  published_at timestamptz,
  constraint tiktok_publish_jobs_library_item_check check (char_length(library_item_id) between 1 and 255),
  constraint tiktok_publish_jobs_idempotency_check check (char_length(idempotency_key) between 8 and 255),
  constraint tiktok_publish_jobs_caption_check check (char_length(caption) <= 2200),
  constraint tiktok_publish_jobs_privacy_check check (privacy_level in (
    'PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'
  )),
  constraint tiktok_publish_jobs_status_check check (status in (
    'scheduled', 'queued', 'uploading', 'processing', 'published', 'failed', 'canceled'
  )),
  constraint tiktok_publish_jobs_attempts_check check (attempts >= 0 and attempts <= 20),
  constraint tiktok_publish_jobs_uploaded_bytes_check check (uploaded_bytes >= 0),
  constraint tiktok_publish_jobs_timestamps_check check (
    updated_at >= created_at
    and scheduled_at >= created_at
    and next_attempt_at >= created_at
    and (published_at is null or published_at >= created_at)
  )
);

create unique index if not exists tiktok_publish_jobs_user_idempotency_unique_idx
  on tiktok_publish_jobs(user_id, idempotency_key);

create index if not exists tiktok_publish_jobs_due_idx
  on tiktok_publish_jobs(next_attempt_at, scheduled_at)
  where status in ('scheduled', 'queued', 'uploading', 'processing');

create index if not exists tiktok_publish_jobs_user_created_idx
  on tiktok_publish_jobs(user_id, created_at desc);

create index if not exists tiktok_publish_jobs_library_item_idx
  on tiktok_publish_jobs(library_item_id, created_at desc);
