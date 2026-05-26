-- migrate:up

-- Per-role pinned image digests for template services.
-- For non-template services we keep using deployments.image_digest as the single value.
alter table deployments add column container_digests jsonb not null default '{}'::jsonb;

-- migrate:down

alter table deployments drop column container_digests;
