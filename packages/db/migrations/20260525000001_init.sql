-- migrate:up

create extension if not exists "pgcrypto";
create extension if not exists "citext";

-- updated_at touch trigger
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

----------------------------------------------------------------------
-- hosts
----------------------------------------------------------------------
create table hosts (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  address text not null,
  docker_socket text not null default '/var/run/docker.sock',
  labels jsonb not null default '{}'::jsonb,
  status text not null default 'unknown',
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger hosts_updated_at before update on hosts
  for each row execute function set_updated_at();

----------------------------------------------------------------------
-- users + sessions
----------------------------------------------------------------------
create table users (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  password_hash text not null,
  role text not null default 'admin',
  totp_secret text,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger users_updated_at before update on users
  for each row execute function set_updated_at();

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash bytea not null unique,
  expires_at timestamptz not null,
  created_ip inet,
  user_agent text,
  created_at timestamptz not null default now()
);
create index sessions_user_id on sessions(user_id);
create index sessions_expires_at on sessions(expires_at);

----------------------------------------------------------------------
-- services
----------------------------------------------------------------------
create table services (
  id uuid primary key default gen_random_uuid(),
  slug citext not null unique,
  name text not null,
  host_id uuid not null references hosts(id) on delete restrict,
  kind text not null,                  -- 'app' | 'managed_pg' | 'managed_redis'
  desired_state text not null default 'running',   -- 'running' | 'stopped' | 'archived'
  current_state text not null default 'pending',   -- 'pending'|'creating'|'starting'|'running'|'degraded'|'stopped'|'failed'
  hostname text,                       -- ingress hint (may be null for non-routed services)
  public_port int,                     -- container port to publish
  config jsonb not null default '{}'::jsonb,
  template text,                       -- e.g. 'eth-archive'; references infra/templates/<name>.json
  owner_id uuid references users(id) on delete set null,
  parent_service_id uuid references services(id) on delete set null,  -- managed siblings link back
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index services_host_id on services(host_id);
create index services_desired_state on services(desired_state) where archived_at is null;
create index services_parent on services(parent_service_id);
create trigger services_updated_at before update on services
  for each row execute function set_updated_at();

----------------------------------------------------------------------
-- deployments
----------------------------------------------------------------------
create table deployments (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references services(id) on delete cascade,
  version int not null,
  image text not null,
  image_digest text,                   -- resolved at deploy time
  env_snapshot jsonb not null default '{}'::jsonb,
  secret_refs jsonb not null default '[]'::jsonb,
  volume_refs jsonb not null default '[]'::jsonb,
  network_refs jsonb not null default '[]'::jsonb,
  command jsonb,
  entrypoint jsonb,
  healthcheck jsonb,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  status text not null default 'pending',   -- 'pending'|'active'|'superseded'|'failed'|'rolled_back'
  unique(service_id, version)
);
create index deployments_service_version on deployments(service_id, version desc);
create index deployments_status on deployments(status);

----------------------------------------------------------------------
-- containers (observed state)
----------------------------------------------------------------------
create table containers (
  id uuid primary key default gen_random_uuid(),
  deployment_id uuid not null references deployments(id) on delete cascade,
  host_id uuid not null references hosts(id) on delete restrict,
  docker_id text not null unique,
  name text,
  state text not null,
  exit_code int,
  started_at timestamptz,
  stopped_at timestamptz,
  last_observed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index containers_deployment_id on containers(deployment_id);
create index containers_host_id on containers(host_id);

----------------------------------------------------------------------
-- volumes + networks
----------------------------------------------------------------------
create table volumes (
  id uuid primary key default gen_random_uuid(),
  service_id uuid references services(id) on delete cascade,
  host_id uuid not null references hosts(id) on delete restrict,
  name text not null,
  driver text not null default 'local',
  mountpoint text,
  size_bytes_estimate bigint,
  created_at timestamptz not null default now(),
  unique(host_id, name)
);

create table networks (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references hosts(id) on delete restrict,
  name text not null,
  driver text not null default 'bridge',
  internal boolean not null default false,
  created_at timestamptz not null default now(),
  unique(host_id, name)
);

----------------------------------------------------------------------
-- env vars + secrets
----------------------------------------------------------------------
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

create table secrets (
  id uuid primary key default gen_random_uuid(),
  service_id uuid references services(id) on delete cascade,
  key text not null,
  ciphertext bytea not null,
  nonce bytea not null,
  key_version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(service_id, key)
);
create trigger secrets_updated_at before update on secrets
  for each row execute function set_updated_at();

----------------------------------------------------------------------
-- tokens (API + RPC)
----------------------------------------------------------------------
create table tokens (
  id uuid primary key default gen_random_uuid(),
  kind text not null,                   -- 'api' | 'rpc'
  name text not null,
  hash bytea not null unique,
  prefix text not null,                 -- first 8 chars for display
  service_id uuid references services(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  scopes text[] not null default '{}',
  tier text not null default 'public',  -- 'public' | 'internal'
  rate_limit_per_min int,
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);
create index tokens_prefix on tokens(prefix);
create index tokens_service on tokens(service_id) where revoked_at is null;

----------------------------------------------------------------------
-- audit log
----------------------------------------------------------------------
create table audit_log (
  id bigserial primary key,
  actor_user_id uuid references users(id) on delete set null,
  actor_token_id uuid references tokens(id) on delete set null,
  action text not null,
  target_kind text not null,
  target_id uuid,
  payload jsonb not null default '{}'::jsonb,
  ip inet,
  at timestamptz not null default now()
);
create index audit_log_target on audit_log(target_kind, target_id, at desc);
create index audit_log_actor on audit_log(actor_user_id, at desc);

----------------------------------------------------------------------
-- node_metrics (Prometheus scrape sink)
----------------------------------------------------------------------
create table node_metrics (
  time timestamptz not null default now(),
  service_id uuid not null references services(id) on delete cascade,
  source text not null,                 -- 'erigon' | 'lighthouse' | 'host'
  metric text not null,
  labels jsonb not null default '{}'::jsonb,
  value double precision not null
);
create index node_metrics_lookup on node_metrics(service_id, source, metric, time desc);
create index node_metrics_time on node_metrics(time desc);

----------------------------------------------------------------------
-- rpc_requests + pre-aggregated rpc_method_stats
----------------------------------------------------------------------
create table rpc_requests (
  time timestamptz not null default now(),
  token_id uuid references tokens(id) on delete set null,
  service_id uuid not null references services(id) on delete cascade,
  method text not null,
  params_bytes int not null default 0,
  response_bytes int not null default 0,
  latency_ms int not null,
  status int not null,
  error_code text
);
create index rpc_requests_token_time on rpc_requests(token_id, time desc);
create index rpc_requests_method_time on rpc_requests(method, time desc);
create index rpc_requests_service_time on rpc_requests(service_id, time desc);

create table rpc_method_stats (
  id uuid primary key default gen_random_uuid(),
  hour timestamptz not null,
  service_id uuid not null references services(id) on delete cascade,
  token_id uuid references tokens(id) on delete set null,
  method text not null,
  count bigint not null,
  error_count bigint not null,
  p50_ms int not null,
  p99_ms int not null
);
create unique index rpc_method_stats_natural on rpc_method_stats
  (hour, service_id, coalesce(token_id, '00000000-0000-0000-0000-000000000000'::uuid), method);

-- migrate:down

drop table if exists rpc_method_stats;
drop table if exists rpc_requests;
drop table if exists node_metrics;
drop table if exists audit_log;
drop table if exists tokens;
drop table if exists secrets;
drop table if exists env_vars;
drop table if exists networks;
drop table if exists volumes;
drop table if exists containers;
drop table if exists deployments;
drop table if exists services;
drop table if exists sessions;
drop table if exists users;
drop table if exists hosts;
drop function if exists set_updated_at();
