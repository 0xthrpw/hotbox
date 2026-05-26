import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from './auth.js';

const QuerySchema = z.object({
  target_kind: z.string().optional(),
  target_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  before: z.coerce.number().int().optional(),    // id-based cursor (descending)
});

export async function auditRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/audit', async (req) => {
    requireAuth(req);
    const q = QuerySchema.parse(req.query);

    let query = fastify.ctx.db
      .selectFrom('audit_log')
      .leftJoin('users', 'users.id', 'audit_log.actor_user_id')
      .select([
        'audit_log.id', 'audit_log.action', 'audit_log.target_kind', 'audit_log.target_id',
        'audit_log.payload', 'audit_log.ip', 'audit_log.at',
        'users.email as actor_email',
      ])
      .orderBy('audit_log.id', 'desc')
      .limit(q.limit);
    if (q.target_kind) query = query.where('audit_log.target_kind', '=', q.target_kind);
    if (q.target_id) query = query.where('audit_log.target_id', '=', q.target_id);
    if (q.before) query = query.where('audit_log.id', '<', q.before);

    const entries = await query.execute();
    return { entries };
  });
}
