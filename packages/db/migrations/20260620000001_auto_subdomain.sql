-- migrate:up

-- Opt-in flag for the auto-subdomain ingress: when true and HOTBOX_AUTO_SUBDOMAIN_BASE
-- is set on the api/reconciler, the reconciler emits a Traefik router for
--   ${slug}-${env_slug}-${project_slug}.${HOTBOX_AUTO_SUBDOMAIN_BASE}
-- in addition to any custom hostname the service already has.
alter table services add column auto_subdomain boolean not null default false;

-- migrate:down

alter table services drop column auto_subdomain;
