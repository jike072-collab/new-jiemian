alter table task_billing_records
  add column if not exists request_fingerprint text;
