-- migrate:up

----------------------------------------------------------------------
-- variables: a single table for project/env/service-scoped env vars.
-- Replaces the unused env_vars table.
--
-- Exactly one of (project_id, environment_id, service_id) is set per
-- row, enforced by the variables_scope_xor check. The `scope` column
-- is denormalized for fast filtering — it must match which FK is set,
-- enforced by variables_scope_matches_fk.
--
-- Plain values live in `value`; secrets live in
-- (ciphertext, nonce, key_version) encrypted via the same keyring as
-- the existing `secrets` table. variables_secret_shape enforces that
-- exactly one of those shapes is populated.
----------------------------------------------------------------------
drop table if exists env_vars;

create table variables (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  environment_id uuid references environments(id) on delete cascade,
  service_id uuid references services(id) on delete cascade,
  scope text not null,                   -- 'project' | 'environment' | 'service'
  key text not null,
  value text,
  ciphertext bytea,
  nonce bytea,
  key_version int,
  is_secret boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint variables_scope_xor check (
    (case when project_id is null then 0 else 1 end)
    + (case when environment_id is null then 0 else 1 end)
    + (case when service_id is null then 0 else 1 end)
    = 1
  ),
  constraint variables_scope_matches_fk check (
    (scope = 'project' and project_id is not null)
    or (scope = 'environment' and environment_id is not null)
    or (scope = 'service' and service_id is not null)
  ),
  constraint variables_secret_shape check (
    (is_secret = true
      and value is null
      and ciphertext is not null
      and nonce is not null
      and key_version is not null)
    or
    (is_secret = false
      and value is not null
      and ciphertext is null
      and nonce is null
      and key_version is null)
  )
);

-- Per-scope uniqueness. Partial indexes so the unique constraint only
-- applies to rows in that scope (the other two scope ids are null).
create unique index variables_uniq_project on variables(project_id, key)
  where project_id is not null;
create unique index variables_uniq_env on variables(environment_id, key)
  where environment_id is not null;
create unique index variables_uniq_service on variables(service_id, key)
  where service_id is not null;

create trigger variables_updated_at before update on variables
  for each row execute function set_updated_at();

-- Backfill: each existing service's most recent deployment.env_snapshot is
-- the only place its env vars live today. Lift each (key, value) into a
-- service-scoped variable row so the new resolveVariables() path returns
-- the same map a fresh redeploy would have produced under the old flow.
--
-- We only look at the latest deployment per service (the active one — older
-- deployments are superseded and their snapshots aren't sources of truth).
-- Values are stored as plain (is_secret=false) because env_snapshot doesn't
-- carry a secret marker; managed-sibling DB passwords already live in the
-- secrets table and don't appear in env_snapshot at all.
do $$
declare
  svc record;
  latest_snapshot jsonb;
  kv record;
begin
  for svc in select id from services where archived_at is null loop
    select env_snapshot into latest_snapshot
    from deployments
    where service_id = svc.id
    order by version desc
    limit 1;

    if latest_snapshot is null then continue; end if;

    for kv in select key, value from jsonb_each_text(latest_snapshot) loop
      insert into variables (service_id, scope, key, value, is_secret)
        values (svc.id, 'service', kv.key, kv.value, false)
        on conflict do nothing;
    end loop;
  end loop;
end $$;

-- migrate:down

drop trigger if exists variables_updated_at on variables;
drop index if exists variables_uniq_service;
drop index if exists variables_uniq_env;
drop index if exists variables_uniq_project;
drop table if exists variables;

-- Restore the env_vars shell so a downgrade doesn't break the schema
-- for anything that still references it (nothing in the app does, but
-- keeping shape parity with the init migration is the safe move).
create table env_vars (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references services(id) on delete cascade,
  key text not null,
  value text not null,
  is_secret boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(service_id, key)
);
create trigger env_vars_updated_at before update on env_vars
  for each row execute function set_updated_at();
