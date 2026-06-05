import type { ServiceWithContext } from '@hotbox/db';
import type { ContainerSpec } from '@hotbox/shared';

/**
 * Compute the auto subdomain hostname for a service, or null if the feature
 * is disabled (no base configured) or the service hasn't opted in. The
 * pattern is deterministic — same shape used by internal-authz to validate
 * token scope against the auto hostname.
 */
export function autoSubdomainFor(
  service: ServiceWithContext,
  autoSubdomainBase: string | null,
): string | null {
  if (!autoSubdomainBase) return null;
  if (!service.auto_subdomain) return null;
  return `${service.slug}-${service.environment_slug}-${service.project_slug}.${autoSubdomainBase}`;
}

/**
 * Generate Traefik labels for a role's container.
 *
 * Behavior:
 *   - Returns {} if the role isn't the ingress target or the service has
 *     no public_port (without a port there's nothing to forward to).
 *   - Up to two routers are emitted: one for the custom hostname (if set)
 *     and one for the auto subdomain (if opted in AND the operator has
 *     set HOTBOX_AUTO_SUBDOMAIN_BASE). Splitting per-hostname keeps each
 *     cert request simple — custom hostnames use HTTP-01 (`le-http`),
 *     auto subdomains share the wildcard DNS-01 cert (`le-dns`).
 *   - Both routers point at the same loadbalancer service (or the same
 *     file-provider service when the container declares `ingress_via`),
 *     so requests on either hostname reach the same container.
 *   - When neither hostname is set, no labels — service has no ingress.
 *
 * Router/service IDs are namespaced project-env-slug to stay unique on the
 * host's Traefik provider (a same-slug service in another env would
 * otherwise collide).
 */
export function traefikLabelsFor(opts: {
  service: ServiceWithContext;
  container: ContainerSpec | null;     // null = legacy 'primary' role (always ingress)
  autoSubdomainBase: string | null;
}): Record<string, string> {
  const isIngress = opts.container ? opts.container.ingress : true;
  if (!isIngress) return {};
  if (!opts.service.public_port) return {};

  const auto = autoSubdomainFor(opts.service, opts.autoSubdomainBase);
  const custom = opts.service.hostname;
  if (!auto && !custom) return {};

  const id = `${opts.service.project_slug}-${opts.service.environment_slug}-${opts.service.slug}`;
  const via = opts.container?.ingress_via;
  const labels: Record<string, string> = { 'traefik.enable': 'true' };

  // The loadbalancer service is shared across both routers and only needs
  // to be defined when we're not delegating ingress to a file-provider
  // service like hotbox-rpc-proxy@file.
  if (!via) {
    labels[`traefik.http.services.${id}.loadbalancer.server.port`] =
      String(opts.service.public_port);
  }

  if (custom) addRouter(labels, {
    routerId: `${id}-custom`,
    serviceId: id,
    hostname: custom,
    certResolver: certResolverForCustom(custom, opts.autoSubdomainBase),
    via,
  });

  if (auto) addRouter(labels, {
    routerId: `${id}-auto`,
    serviceId: id,
    hostname: auto,
    certResolver: 'le-dns',
    via,
  });

  return labels;
}

/**
 * Pick the cert resolver for a custom hostname.
 *
 * If the hostname is a single label directly under the auto-subdomain base
 * (e.g. `testy.on.hotbox.wtf` when the base is `on.hotbox.wtf`), it's already
 * covered by the wildcard `*.${base}` cert that `le-dns` issues — so reuse
 * that resolver and skip a redundant per-name HTTP-01 issuance (which would
 * spend an ACME challenge and an LE rate-limit slot for a cert we already
 * have). Anything else — a truly external domain, or a multi-label host the
 * single-level wildcard can't cover — uses `le-http`. Also falls back to
 * `le-http` when no base is configured, since `le-dns` has no creds then.
 */
function certResolverForCustom(
  hostname: string,
  autoSubdomainBase: string | null,
): 'le-http' | 'le-dns' {
  if (autoSubdomainBase && isSingleLabelUnder(hostname, autoSubdomainBase)) {
    return 'le-dns';
  }
  return 'le-http';
}

function isSingleLabelUnder(hostname: string, base: string): boolean {
  const suffix = `.${base}`;
  if (!hostname.endsWith(suffix)) return false;
  const label = hostname.slice(0, -suffix.length);
  return label.length > 0 && !label.includes('.');
}

function addRouter(
  labels: Record<string, string>,
  opts: {
    routerId: string;
    serviceId: string;
    hostname: string;
    certResolver: 'le-http' | 'le-dns';
    via: string | undefined;
  },
): void {
  labels[`traefik.http.routers.${opts.routerId}.rule`] = `Host(\`${opts.hostname}\`)`;
  labels[`traefik.http.routers.${opts.routerId}.entrypoints`] = 'websecure';
  labels[`traefik.http.routers.${opts.routerId}.tls.certresolver`] = opts.certResolver;

  if (opts.via) {
    labels[`traefik.http.routers.${opts.routerId}.service`] = opts.via;
    labels[`traefik.http.routers.${opts.routerId}.middlewares`] = 'hotbox-auth@file';
  } else {
    labels[`traefik.http.routers.${opts.routerId}.service`] = opts.serviceId;
  }
}
