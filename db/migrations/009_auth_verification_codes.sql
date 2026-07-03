alter table app_users
  add column if not exists phone text;

create unique index if not exists app_users_phone_unique
  on app_users(phone)
  where phone is not null;

create table if not exists auth_verification_codes (
  verification_id uuid primary key,
  destination text not null,
  channel text not null,
  purpose text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  attempt_count integer not null default 0,
  send_count integer not null default 1,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint auth_verification_codes_channel_check check (channel in ('email', 'phone')),
  constraint auth_verification_codes_purpose_check check (purpose in ('register', 'password_reset')),
  constraint auth_verification_codes_attempt_count_check check (attempt_count >= 0),
  constraint auth_verification_codes_send_count_check check (send_count > 0),
  constraint auth_verification_codes_hash_not_raw_check check (length(code_hash) >= 32)
);

create index if not exists auth_verification_codes_lookup_idx
  on auth_verification_codes(destination, purpose, created_at desc)
  where consumed_at is null;

create index if not exists auth_verification_codes_expiry_idx
  on auth_verification_codes(expires_at)
  where consumed_at is null;
