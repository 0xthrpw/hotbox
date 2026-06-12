-- migrate:up

----------------------------------------------------------------------
-- invites (single-use signup links; only the token hash is stored)
----------------------------------------------------------------------
create table invites (
  id uuid primary key default gen_random_uuid(),
  token_hash bytea not null unique,
  note text,
  role text not null default 'member',
  created_by uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references users(id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index invites_created_at on invites(created_at desc);

-- migrate:down

drop table if exists invites;
