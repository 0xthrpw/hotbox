import type { Service } from '@hotbox/db';

/**
 * Generate Traefik labels for a service container. The Docker provider
 * auto-discovers these, so we don't need to call Traefik's API.
 *
 * Returns an empty object when the service has no hostname (no ingress).
 */
export function traefikLabelsFor(service: Service, opts: { requireAuth: boolean }): Record<string, string> {
  if (!service.hostname || !service.public_port) return {};
  const id = service.slug;
  const labels: Record<string, string> = {
    'traefik.enable': 'true',
    [`traefik.http.routers.${id}.rule`]: `Host(\`${service.hostname}\`)`,
    [`traefik.http.routers.${id}.entrypoints`]: 'websecure',
    [`traefik.http.routers.${id}.tls.certresolver`]: 'le',
    [`traefik.http.services.${id}.loadbalancer.server.port`]: String(service.public_port),
  };
  if (opts.requireAuth) {
    labels[`traefik.http.routers.${id}.middlewares`] = 'hotbox-auth@file';
  }
  return labels;
}
