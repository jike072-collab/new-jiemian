alter table billing_orders
  drop constraint if exists billing_orders_status_check;

alter table billing_orders
  add constraint billing_orders_status_check
  check (
    status in ('pending', 'processing', 'paid', 'failed', 'cancelled', 'expired', 'review', 'refunded')
  );
