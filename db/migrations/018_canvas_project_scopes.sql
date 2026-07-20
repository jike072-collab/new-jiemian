alter table canvas_projects
  add column if not exists workspace_scope text not null default 'personal';

alter table canvas_projects
  drop constraint if exists canvas_projects_workspace_scope_check;

alter table canvas_projects
  add constraint canvas_projects_workspace_scope_check
  check (workspace_scope in ('personal', 'shared'));

create index if not exists canvas_projects_workspace_updated_idx
  on canvas_projects(user_id, workspace_scope, updated_at desc);
