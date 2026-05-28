import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import { ZodError } from 'zod';
import type { AppContext } from './context.js';
import { attachSession, authRoutes } from './routes/auth.js';
import { servicesRoutes } from './routes/services.js';
import { projectsRoutes } from './routes/projects.js';
import { variablesRoutes } from './routes/variables.js';
import { metaRoutes } from './routes/meta.js';
import { tokensRoutes } from './routes/tokens.js';
import { logsRoutes } from './routes/logs.js';
import { driftRoutes } from './routes/drift.js';
import { internalAuthzRoutes } from './routes/internal-authz.js';
import { metricsRoutes } from './routes/metrics.js';
import { templatesRoutes } from './routes/templates.js';
import { auditRoutes } from './routes/audit.js';

export async function buildServer(ctx: AppContext): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

  app.decorate('ctx', ctx);

  await app.register(cookie, {});
  await app.register(cors, {
    origin: process.env.WEB_ORIGIN ?? true,
    credentials: true,
  });

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'validation_failed', issues: err.issues });
    }
    const status = err.statusCode ?? 500;
    return reply.code(status).send({ error: err.message });
  });

  await app.register(async (instance) => {
    await attachSession(instance);
    await authRoutes(instance);
    await metaRoutes(instance);
    await projectsRoutes(instance);
    await variablesRoutes(instance);
    await servicesRoutes(instance);
    await tokensRoutes(instance);
    await logsRoutes(instance);
    await driftRoutes(instance);
    await metricsRoutes(instance);
    await templatesRoutes(instance);
    await auditRoutes(instance);
  }, { prefix: '/api' });

  // Internal routes used by Traefik ForwardAuth — no /api prefix, no session.
  await app.register(internalAuthzRoutes);

  return app;
}
