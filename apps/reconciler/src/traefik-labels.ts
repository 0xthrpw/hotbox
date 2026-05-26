import type { Service } from '@hotbox/db';
import type { ContainerSpec } from '@hotbox/shared';

/**
 * Generate Traefik labels for a role's container. Traefik's docker provider
 * picks these up — no API calls needed.
 *
 * Behavior:
 *   - Returns {} if the role is not the ingress target or the service has no
 *     hostname/public_port (no public route).
 *   - If the container declares `ingress_via: 'name@file'`, the router points
 *     at that file-provider service (and the hotbox-auth ForwardAuth runs).
 *     This is how RPC traffic flows Traefik → ForwardAuth → rpc-proxy → Erigon.
 *   - Otherwise routes directly to this container on `service.public_port`.
 */
export function traefikLabelsFor(opts: {
  service: Service;
  container: ContainerSpec | null;     // null = legacy 'primary' role (always ingress)
}): Record<string, string> {
  const isIngress = opts.container ? opts.container.ingress : true;
  if (!isIngress) return {};
  if (!opts.service.hostname || !opts.service.public_port) return {};

  const id = opts.service.slug;
  const labels: Record<string, string> = {
    'traefik.enable': 'true',
    [`traefik.http.routers.${id}.rule`]: `Host(\`${opts.service.hostname}\`)`,
    [`traefik.http.routers.${id}.entrypoints`]: 'websecure',
    [`traefik.http.routers.${id}.tls.certresolver`]: 'le',
  };

  const via = opts.container?.ingress_via;
  if (via) {
    labels[`traefik.http.routers.${id}.service`] = via;
    labels[`traefik.http.routers.${id}.middlewares`] = 'hotbox-auth@file';
  } else {
    labels[`traefik.http.services.${id}.loadbalancer.server.port`] = String(opts.service.public_port);
  }

  return labels;
}
