alter table task_billing_records
  drop constraint if exists task_billing_records_state_check;

alter table task_billing_records
  add constraint task_billing_records_state_check check (
    billing_state in (
      'prechecked',
      'dispatching',
      'provider_started',
      'accepted',
      'settled',
      'failed',
      'cancelled',
      'reconciliation_required'
    )
  );
