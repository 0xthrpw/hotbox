import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from './auth.js';

/**
 * GitHub App support routes for the dashboard: which installations exist,
 * and which repos an installation can reach (drives the create-form repo
 * picker, including private repos).
 */
export async function githubRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/github/installations', async (req) => {
    requireAuth(req);
    if (!fastify.ctx.githubApp) return { configured: false, installations: [] };
    const installations = await fastify.ctx.db
      .selectFrom('github_installations')
      .select(['installation_id', 'account_login', 'account_type', 'suspended_at'])
      .orderBy('account_login')
      .execute();
    return { configured: true, installations };
  });

  fastify.get('/github/repos', async (req, reply) => {
    requireAuth(req);
    const app = fastify.ctx.githubApp;
    if (!app) return reply.code(400).send({ error: 'GitHub App not configured' });
    const { installation_id } = z
      .object({ installation_id: z.coerce.number().int().positive() })
      .parse(req.query);
    const repos = await app.installationRepos(installation_id);
    return { repos };
  });
}
