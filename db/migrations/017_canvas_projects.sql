create table if not exists canvas_projects (
  id uuid primary key,
  user_id uuid not null references app_users(local_user_id) on delete cascade,
  title text not null,
  document jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint canvas_projects_title_check check (char_length(title) between 1 and 120),
  constraint canvas_projects_document_check check (jsonb_typeof(document) = 'object'),
  constraint canvas_projects_version_check check (version > 0),
  constraint canvas_projects_timestamps_check check (updated_at >= created_at)
);

create index if not exists canvas_projects_user_updated_idx
  on canvas_projects(user_id, updated_at desc);
