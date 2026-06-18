-- Track webhook processing separately from order status so interrupted callbacks can be retried safely.

alter table billing_webhook_events
  drop constraint if exists billing_webhook_events_status_check;

update billing_webhook_events
set status = case
  when status in ('duplicate', 'accepted') then 'completed'
  when status in ('rejected', 'review') then 'failed'
  when status in ('received', 'processing', 'completed', 'failed') then status
  else 'failed'
end;

alter table billing_webhook_events
  add constraint billing_webhook_events_status_check
  check (status in ('received', 'processing', 'completed', 'failed'));
