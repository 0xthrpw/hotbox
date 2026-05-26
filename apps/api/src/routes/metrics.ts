import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from 'kysely';
import { requireAuth } from './auth.js';

export async function metricsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/services/:id/metrics/latest', async (req, reply) => {
    requireAuth(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    const rows = await fastify.ctx.db
      .selectFrom('node_metrics as m')
      .innerJoin(
        fastify.ctx.db
          .selectFrom('node_metrics')
          .select(['source', 'metric', sql<Date>`max(time)`.as('max_time')])
          .where('service_id', '=', id)
          .groupBy(['source', 'metric'])
          .as('latest'),
        (join) => join
          .onRef('m.source', '=', 'latest.source')
          .onRef('m.metric', '=', 'latest.metric')
          .onRef('m.time', '=', 'latest.max_time'),
      )
      .select(['m.source', 'm.metric', 'm.labels', 'm.value', 'm.time'])
      .where('m.service_id', '=', id)
      .execute();

    return reply.send({ metrics: rows });
  });

  fastify.get('/services/:id/rpc-stats', async (req, reply) => {
    requireAuth(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const hours = z.coerce.number().int().positive().max(168).default(24).parse((req.query as { hours?: unknown })?.hours);

    const since = new Date(Date.now() - hours * 3600 * 1000);
    const topMethods = await fastify.ctx.db
      .selectFrom('rpc_method_stats')
      .select([
        'method',
        sql<number>`sum(count)`.as('count'),
        sql<number>`sum(error_count)`.as('error_count'),
        sql<number>`max(p50_ms)`.as('p50_ms'),
        sql<number>`max(p99_ms)`.as('p99_ms'),
      ])
      .where('service_id', '=', id)
      .where('hour', '>=', since)
      .groupBy('method')
      .orderBy(sql`sum(count)`, 'desc')
      .limit(15)
      .execute();

    return reply.send({ top_methods: topMethods });
  });
}
