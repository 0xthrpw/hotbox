-- migrate:up

----------------------------------------------------------------------
-- webhook_deliveries: per-source log of received GitHub deliveries and
-- what hotbox decided about them — answers "why didn't my push build?"
-- from the dashboard. Pruned to the newest ~50 rows per source on insert.
----------------------------------------------------------------------
create table webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  github_source_id uuid not null references github_sources(id) on delete cascade,
  via text not null,                     -- 'source' (per-repo webhook) | 'app'
  delivery_id text,                      -- GitHub's X-GitHub-Delivery header
  event text not null,                   -- 'push' | 'ping' | …
  ref text,                              -- payload.ref for pushes
  head_sha text,                         -- payload.head_commit.id
  action text not null,                  -- 'build' | 'ignore' | 'rejected'
  reason text,                           -- 'ref-mismatch' | 'already-queued' | 'signature-mismatch' | …
  build_id uuid references builds(id) on delete set null,
  created_at timestamptz not null default now()
);
create index webhook_deliveries_source_created
  on webhook_deliveries(github_source_id, created_at desc);

-- migrate:down

drop table if exists webhook_deliveries;
