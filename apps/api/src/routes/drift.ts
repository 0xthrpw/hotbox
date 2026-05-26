import type { FastifyInstance } from 'fastify';
import { computeDrift } from '@hotbox/reconciler';
import { requireAuth } from './auth.js';

export async function driftRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/drift', async (req) => {
    requireAuth(req);
    return computeDrift(fastify.ctx.db, fastify.ctx.docker);
  });
}
