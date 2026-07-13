alter table auth_verification_codes
  drop constraint if exists auth_verification_codes_purpose_check;

alter table auth_verification_codes
  add constraint auth_verification_codes_purpose_check
  check (purpose in ('register', 'password_reset', 'login'));
