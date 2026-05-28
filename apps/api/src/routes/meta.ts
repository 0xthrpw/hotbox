import type { FastifyInstance } from 'fastify';

/**
 * Public-ish config the web UI needs to render correctly. Currently just
 * the auto-subdomain base, so the create form can show a live preview of
 * the URL a service would get if auto_subdomain is checked. Adding more
 * fields here is cheaper than spinning up a new route per setting.
 */
export async function metaRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/meta', async () => {
    return {
      auto_subdomain_base: fastify.ctx.autoSubdomainBase,
    };
  });
}
