import type { FastifyInstance } from 'fastify';
import { listTemplates, loadTemplate } from '@hotbox/shared';
import { requireAuth } from './auth.js';

export async function templatesRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/templates', async (req) => {
    requireAuth(req);
    const names = await listTemplates();
    const templates = await Promise.all(
      names.map(async (name) => {
        const t = await loadTemplate(name);
        return {
          id: t.id,
          label: t.label,
          description: t.description,
          // hint for the UI: which image to pre-fill, which roles get the ingress
          primary_image: t.containers.find((c) => c.ingress)?.image ?? t.containers[0]?.image,
          requires_hostname: t.containers.some((c) => c.ingress),
        };
      }),
    );
    return { templates };
  });
}
