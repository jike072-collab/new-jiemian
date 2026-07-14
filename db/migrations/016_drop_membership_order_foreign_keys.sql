alter table user_memberships
  drop constraint if exists user_memberships_source_order_id_fkey;

alter table membership_entitlements
  drop constraint if exists membership_entitlements_source_order_id_fkey;

alter table membership_entitlement_ledger
  drop constraint if exists membership_entitlement_ledger_source_order_id_fkey;
