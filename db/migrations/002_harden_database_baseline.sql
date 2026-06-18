-- Harden BP-01A database invariants without deleting data or changing table ownership.

alter table auth_sessions
  drop constraint if exists auth_sessions_token_hash_not_raw_check;

alter table auth_sessions
  add constraint auth_sessions_token_hash_sha256_hex_check
  check (token_hash ~ '^[a-f0-9]{64}$');
