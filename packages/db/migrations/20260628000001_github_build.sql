-- migrate:up

-- Where a service's image comes from:
--   'image'  : pull a prebuilt image from a registry (the original behavior)
--   'github' : clone a public repo:branch and build the image on the host
alter table services add column image_source text not null default 'image';

----------------------------------------------------------------------
-- github_sources: one row per github-backed service
----------------------------------------------------------------------
create table github_sources (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null unique references services(id) on delete cascade,
  repo_full_name text not null,            -- 'owner/repo'
  branch text not null,
  dockerfile_path text not null default 'Dockerfile',
  build_context text not null default '.',
  last_built_sha text,
  -- Reserved for the Phase 4b webhook path (per-source HMAC secret). Unused
  -- in 4a (public repos, manual + first-deploy builds only).
  webhook_secret text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger github_sources_updated_at before update on github_sources
  for each row execute function set_updated_at();

----------------------------------------------------------------------
-- builds: one row per build attempt
----------------------------------------------------------------------
create table builds (
  id uuid primary key default gen_random_uuid(),
  github_source_id uuid not null references github_sources(id) on delete cascade,
  service_id uuid not null references services(id) on delete cascade,
  commit_sha text,                         -- learned after clone
  commit_message text,
  commit_author text,
  triggered_by text not null,              -- 'first-deploy' | 'manual' (4b: 'webhook')
  status text not null default 'queued',   -- queued|cloning|building|deploying|success|failed
  image_tag text,
  image_digest text,
  log text,                                -- captured build output, capped by the worker
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);
create index builds_service_created on builds(service_id, created_at desc);
create index builds_status on builds(status);

-- migrate:down

drop table if exists builds;
drop trigger if exists github_sources_updated_at on github_sources;
drop table if exists github_sources;
alter table services drop column image_source;
