import type { FastifyInstance } from 'fastify';
import { verifyToken } from '../tokens.js';

/**
 * Traefik ForwardAuth target. Validates the token, checks that the token's
 * service_id (if scoped) matches the routed service, and stamps the token id
 * + tier as response headers so the rpc-proxy can pick them up.
 *
 * The token can arrive two ways, checked in this order:
 *   1. `Authorization: Bearer hbx_rpc_…` header
 *   2. inline as the first URL path segment (`https://rpc.example/hbx_rpc_…`),
 *      Alchemy-style. ForwardAuth hands us the original URI as
 *      X-Forwarded-Uri; the rpc-proxy never reads the path, so nothing
 *      downstream has to strip the segment.
 *
 * Returns 200 on success, 401 on missing/invalid/expired, 403 on scope mismatch.
 * MUST stay fast — no audit-log writes on the hot path.
 *
 * Hostname matching: the request can arrive on either the service's custom
 * `hostname` field or the deterministic auto subdomain
 * (`${slug}-${env}-${project}.${autoSubdomainBase}`); both are valid for a
 * service-scoped token. We compute the auto subdomain locally rather than
 * reading it back from anywhere — the reconciler uses the same formula in
 * traefik-labels.ts, so the two must stay in lock-step.
 */
/** First path segment of X-Forwarded-Uri iff it looks like a hotbox token. */
export function tokenFromForwardedUri(uri: string | undefined): string | null {
  if (!uri) return null;
  const m = /^\/(hbx_[a-z]+_[A-Za-z0-9_-]+)(?:[/?]|$)/.exec(uri);
  return m?.[1] ?? null;
}

export async function internalAuthzRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/internal/authz', async (req, reply) => {
    const auth = req.headers['authorization'];
    const fwdUri = req.headers['x-forwarded-uri'];
    const plain = auth?.startsWith('Bearer ')
      ? auth.slice('Bearer '.length).trim()
      : tokenFromForwardedUri(Array.isArray(fwdUri) ? fwdUri[0] : fwdUri);
    if (!plain) return reply.code(401).send();
    const token = await verifyToken(fastify.ctx.db, plain);
    if (!token) return reply.code(401).send();

    // Traefik adds X-Forwarded-Host with the original Host header.
    const host = req.headers['x-forwarded-host'];
    if (host && token.service_id) {
      const svc = await fastify.ctx.db
        .selectFrom('services')
        .innerJoin('projects', 'projects.id', 'services.project_id')
        .innerJoin('environments', 'environments.id', 'services.environment_id')
        .select([
          'services.id',
          'services.slug',
          'services.hostname',
          'services.auto_subdomain',
          'projects.slug as project_slug',
          'environments.slug as environment_slug',
        ])
        .where('services.id', '=', token.service_id)
        .executeTakeFirst();
      if (!svc) return reply.code(403).send();

      const accepted: string[] = [];
      if (svc.hostname) accepted.push(svc.hostname);
      if (svc.auto_subdomain && fastify.ctx.autoSubdomainBase) {
        accepted.push(
          `${svc.slug}-${svc.environment_slug}-${svc.project_slug}.${fastify.ctx.autoSubdomainBase}`,
        );
      }

      if (!accepted.includes(host as string)) return reply.code(403).send();
    }

    reply.header('x-hotbox-token-id', token.id);
    reply.header('x-hotbox-token-tier', token.tier);
    reply.header('x-hotbox-token-scopes', token.scopes.join(','));
    if (token.service_id) reply.header('x-hotbox-service-id', token.service_id);
    return reply.code(200).send();
  });
}
