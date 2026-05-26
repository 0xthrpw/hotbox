import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { streamLogs } from '@hotbox/docker';
import { requireAuth } from './auth.js';

const QuerySchema = z.object({
  since: z.coerce.number().int().optional(),
  tail: z.coerce.number().int().positive().max(5000).default(200),
});

export async function logsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/services/:id/logs/stream', async (req, reply: FastifyReply) => {
    requireAuth(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const query = QuerySchema.parse(req.query);

    const containers = await fastify.ctx.db
      .selectFrom('containers')
      .innerJoin('deployments', 'deployments.id', 'containers.deployment_id')
      .select(['containers.docker_id', 'containers.name'])
      .where('deployments.service_id', '=', id)
      .where('deployments.status', '=', 'active')
      .execute();

    if (containers.length === 0) {
      return reply.code(404).send({ error: 'no running containers' });
    }

    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      'connection': 'keep-alive',
      'x-accel-buffering': 'no',
    });

    const send = (event: string, payload: unknown) => {
      reply.raw.write(`event: ${event}\n`);
      reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    const aborts = containers.map(() => new AbortController());
    req.raw.on('close', () => { for (const a of aborts) a.abort(); reply.raw.end(); });

    await Promise.all(
      containers.map(async (c, idx) => {
        try {
          for await (const chunk of streamLogs(fastify.ctx.docker, c.docker_id, {
            since: query.since,
            tail: query.tail,
          })) {
            if (aborts[idx]?.signal.aborted) return;
            send('log', {
              container: c.name ?? c.docker_id.slice(0, 12),
              stream: chunk.stream,
              line: chunk.data.toString('utf8'),
            });
          }
        } catch (err) {
          send('error', { container: c.name, message: (err as Error).message });
        }
      }),
    );

    reply.raw.end();
  });
}
