-- migrate:up

----------------------------------------------------------------------
-- projects
----------------------------------------------------------------------
create table projects (
  id uuid primary key default gen_random_uuid(),
  slug citext not null unique,
  name text not null,
  owner_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create trigger projects_updated_at before update on projects
  for each row execute function set_updated_at();

----------------------------------------------------------------------
-- environments
----------------------------------------------------------------------
create table environments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete restrict,
  slug citext not null,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id, slug)
);
create index environments_project on environments(project_id);
create trigger environments_updated_at before update on environments
  for each row execute function set_updated_at();

----------------------------------------------------------------------
-- services: add project_id + environment_id, rework slug uniqueness
----------------------------------------------------------------------
alter table services add column project_id uuid references projects(id) on delete restrict;
alter table services add column environment_id uuid references environments(id) on delete restrict;

-- Always seed a default/production pair so a fresh install has somewhere
-- to put its first service. If existing services predate this migration
-- (they had no project/env), assign them to the same default pair.
do $$
declare
  default_proj_id uuid;
  default_env_id uuid;
begin
  insert into projects (slug, name) values ('default', 'Default')
    returning id into default_proj_id;
  insert into environments (project_id, slug, name)
    values (default_proj_id, 'production', 'Production')
    returning id into default_env_id;
  update services set project_id = default_proj_id, environment_id = default_env_id
    where project_id is null;
end $$;

alter table services alter column project_id set not null;
alter table services alter column environment_id set not null;

-- Replace global slug uniqueness with per-(project, environment) uniqueness.
-- The original constraint was created from `slug citext not null unique` at
-- column-definition time, which Postgres auto-names <table>_<column>_key.
alter table services drop constraint services_slug_key;
create unique index services_slug_per_env on services(project_id, environment_id, slug);
create index services_project on services(project_id);
create index services_environment on services(environment_id);

-- migrate:down

drop index if exists services_environment;
drop index if exists services_project;
drop index if exists services_slug_per_env;
-- Best-effort restore of the original global uniqueness — only safe if no
-- two services now share a slug across (project, env) pairs. If this fails,
-- the operator needs to resolve duplicates by hand before downgrading.
alter table services add constraint services_slug_key unique (slug);
alter table services alter column environment_id drop not null;
alter table services alter column project_id drop not null;
alter table services drop column environment_id;
alter table services drop column project_id;

drop trigger if exists environments_updated_at on environments;
drop index if exists environments_project;
drop table if exists environments;

drop trigger if exists projects_updated_at on projects;
drop table if exists projects;
