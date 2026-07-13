alter table billing_orders
  drop constraint if exists billing_orders_amount_check;

alter table billing_orders
  add constraint billing_orders_amount_check
  check (
    paid_amount >= 0
    and credited_quota >= 0
    and (
      requested_amount > 0
      or (
        channel = 'admin_grant'
        and requested_amount = 0
        and paid_amount = 0
        and credited_quota > 0
      )
    )
  );
