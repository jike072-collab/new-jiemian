alter table tiktok_publish_jobs
  add column if not exists delivery_mode text not null default 'direct';

alter table tiktok_publish_jobs
  drop constraint if exists tiktok_publish_jobs_delivery_mode_check;

alter table tiktok_publish_jobs
  add constraint tiktok_publish_jobs_delivery_mode_check
  check (delivery_mode in ('direct', 'creator_inbox'));
