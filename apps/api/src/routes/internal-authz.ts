import type { FastifyInstance } from 'fastify';
import { verifyToken } from '../tokens.js';

/**
 * Traefik ForwardAuth target. Validates the bearer token, checks that the
 * token's service_id (if scoped) matches the routed service, and stamps the
 * token id + tier as response headers so the rpc-proxy can pick them up.
 *
 * Returns 200 on success, 401 on missing/invalid/expired, 403 on scope mismatch.
 * MUST stay fast — no audit-log writes on the hot path.
 */
export async function internalAuthzRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/internal/authz', async (req, reply) => {
    const auth = req.headers['authorization'];
    if (!auth?.startsWith('Bearer ')) return reply.code(401).send();
    const plain = auth.slice('Bearer '.length).trim();
    const token = await verifyToken(fastify.ctx.db, plain);
    if (!token) return reply.code(401).send();

    // Traefik adds X-Forwarded-Host with the original Host header.
    const host = req.headers['x-forwarded-host'];
    if (host && token.service_id) {
      const svc = await fastify.ctx.db
        .selectFrom('services')
        .select(['id', 'hostname'])
        .where('id', '=', token.service_id)
        .executeTakeFirst();
      if (!svc || svc.hostname !== host) return reply.code(403).send();
    }

    reply.header('x-hotbox-token-id', token.id);
    reply.header('x-hotbox-token-tier', token.tier);
    reply.header('x-hotbox-token-scopes', token.scopes.join(','));
    if (token.service_id) reply.header('x-hotbox-service-id', token.service_id);
    return reply.code(200).send();
  });
}
