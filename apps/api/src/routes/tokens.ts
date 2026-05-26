import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CreateTokenInputSchema } from '@hotbox/shared';
import { issueToken } from '../tokens.js';
import { requireAuth } from './auth.js';

export async function tokensRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/tokens', async (req) => {
    requireAuth(req);
    const rows = await fastify.ctx.db
      .selectFrom('tokens')
      .select([
        'id', 'kind', 'name', 'prefix', 'service_id', 'user_id', 'tier',
        'scopes', 'rate_limit_per_min', 'expires_at', 'revoked_at',
        'last_used_at', 'created_at',
      ])
      .orderBy('created_at', 'desc')
      .execute();
    return { tokens: rows };
  });

  fastify.post('/tokens', async (req, reply) => {
    requireAuth(req);
    const input = CreateTokenInputSchema.parse(req.body);
    const issued = await issueToken(fastify.ctx.db, {
      kind: input.kind,
      name: input.name,
      tier: input.tier,
      serviceId: input.service_id,
      userId: req.user.id,
      scopes: input.scopes,
      rateLimitPerMin: input.rate_limit_per_min,
      expiresAt: input.expires_at ? new Date(input.expires_at) : undefined,
    });
    return reply.code(201).send({ id: issued.id, token: issued.plain, prefix: issued.prefix });
  });

  fastify.post('/tokens/:id/revoke', async (req, reply) => {
    requireAuth(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await fastify.ctx.db
      .updateTable('tokens')
      .set({ revoked_at: new Date() })
      .where('id', '=', id)
      .execute();
    return reply.send({ ok: true });
  });
}
