alter table membership_entitlements
  drop constraint if exists membership_entitlements_kind_check;

alter table membership_entitlements
  add constraint membership_entitlements_kind_check
  check (kind in (
    'prompt_optimize',
    'image_generation',
    'video_generation',
    'image_edit',
    'image_upscale',
    'video_upscale'
  ));

alter table membership_entitlement_ledger
  drop constraint if exists membership_entitlement_ledger_kind_check;

alter table membership_entitlement_ledger
  add constraint membership_entitlement_ledger_kind_check
  check (kind in (
    'prompt_optimize',
    'image_generation',
    'video_generation',
    'image_edit',
    'image_upscale',
    'video_upscale'
  ));

alter table task_billing_records
  drop constraint if exists task_billing_records_membership_entitlement_check;

alter table task_billing_records
  add constraint task_billing_records_membership_entitlement_check
  check (
    (membership_entitlement_kind is null and membership_entitlement_units = 0)
    or
    (
      membership_entitlement_kind in (
        'prompt_optimize',
        'image_generation',
        'video_generation',
        'image_edit',
        'image_upscale',
        'video_upscale'
      )
      and membership_entitlement_units > 0
    )
  );

alter table usage_records
  drop constraint if exists usage_records_operation_check;

alter table usage_records
  add constraint usage_records_operation_check
  check (
    operation in (
      'cloud_image_generation',
      'cloud_image_edit',
      'cloud_video_generation',
      'cloud_image_upscale',
      'cloud_video_upscale',
      'prompt_optimize'
    )
  );
