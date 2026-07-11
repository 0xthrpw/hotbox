-- migrate:up

----------------------------------------------------------------------
-- github_installations: one row per GitHub App installation, maintained
-- by the /webhooks/github-app endpoint (installation created/deleted/
-- suspend/unsuspend events).
----------------------------------------------------------------------
create table github_installations (
  id uuid primary key default gen_random_uuid(),
  installation_id bigint not null unique,     -- GitHub's installation id
  account_login text not null,                -- user/org the App is installed on
  account_type text not null default 'User',  -- 'User' | 'Organization'
  suspended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger github_installations_updated_at before update on github_installations
  for each row execute function set_updated_at();

-- A source with an installation clones via a short-lived App installation
-- token (private repos). Null keeps the 4a behavior: credential-less public
-- clone. On uninstall the FK nulls out — the next build of a private repo
-- fails with a clear error instead of silently using a dead installation.
alter table github_sources add column installation_id bigint
  references github_installations(installation_id) on delete set null;

-- migrate:down

alter table github_sources drop column installation_id;
drop trigger if exists github_installations_updated_at on github_installations;
drop table if exists github_installations;
