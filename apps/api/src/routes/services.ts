import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CreateServiceInputSchema, CreateDeploymentInputSchema } from '@hotbox/shared';
import { requireAuth } from './auth.js';
import { recordAudit } from '../audit.js';

export async function servicesRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/services', async (req) => {
    requireAuth(req);
    const rows = await fastify.ctx.db
      .selectFrom('services')
      .selectAll()
      .where('host_id', '=', fastify.ctx.hostId)
      .where('archived_at', 'is', null)
      .orderBy('created_at', 'desc')
      .execute();
    return { services: rows };
  });

  fastify.get('/services/:id', async (req, reply) => {
    requireAuth(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const svc = await fastify.ctx.db
      .selectFrom('services')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!svc) return reply.code(404).send({ error: 'not found' });
    const deployments = await fastify.ctx.db
      .selectFrom('deployments')
      .selectAll()
      .where('service_id', '=', id)
      .orderBy('version', 'desc')
      .limit(20)
      .execute();
    const containers = deployments.length
      ? await fastify.ctx.db
          .selectFrom('containers')
          .selectAll()
          .where('deployment_id', 'in', deployments.map((d) => d.id))
          .execute()
      : [];
    return { service: svc, deployments, containers };
  });

  fastify.post('/services', async (req, reply) => {
    requireAuth(req);
    const input = CreateServiceInputSchema.parse(req.body);
    const existing = await fastify.ctx.db
      .selectFrom('services')
      .select('id')
      .where('slug', '=', input.slug)
      .executeTakeFirst();
    if (existing) return reply.code(409).send({ error: 'slug taken' });

    const svc = await fastify.ctx.db
      .insertInto('services')
      .values({
        slug: input.slug,
        name: input.name,
        host_id: fastify.ctx.hostId,
        kind: input.kind,
        hostname: input.hostname ?? null,
        public_port: input.public_port ?? null,
        config: input.config,
        template: input.template ?? null,
        owner_id: req.user.id,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    const deployment = await fastify.ctx.db
      .insertInto('deployments')
      .values({
        service_id: svc.id,
        version: 1,
        image: input.image,
        env_snapshot: input.env,
        created_by: req.user.id,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await recordAudit(fastify.ctx.db, req, {
      action: 'service.create',
      target_kind: 'service',
      target_id: svc.id,
      payload: { slug: svc.slug, template: svc.template, image: input.image },
    });

    fastify.ctx.reconciler.reconcileSoon(svc.id);
    return { service: svc, deployment };
  });

  fastify.post('/services/:id/deployments', async (req, reply) => {
    requireAuth(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const input = CreateDeploymentInputSchema.parse(req.body);
    const svc = await fastify.ctx.db
      .selectFrom('services')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!svc) return reply.code(404).send({ error: 'not found' });

    const latest = await fastify.ctx.db
      .selectFrom('deployments')
      .select(['version', 'image', 'env_snapshot'])
      .where('service_id', '=', id)
      .orderBy('version', 'desc')
      .executeTakeFirst();

    const image = input.image ?? latest?.image;
    if (!image) return reply.code(400).send({ error: 'no previous deployment to reuse image from' });
    const env = input.env ?? ((latest?.env_snapshot as Record<string, string> | undefined) ?? {});

    const deployment = await fastify.ctx.db
      .insertInto('deployments')
      .values({
        service_id: id,
        version: (latest?.version ?? 0) + 1,
        image,
        env_snapshot: env,
        created_by: req.user.id,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await recordAudit(fastify.ctx.db, req, {
      action: 'deployment.create',
      target_kind: 'deployment',
      target_id: deployment.id,
      payload: { service_id: id, version: deployment.version, image, redeploy: !input.image },
    });

    fastify.ctx.reconciler.reconcileSoon(id);
    return { deployment };
  });

  fastify.post('/services/:id/archive', async (req, reply) => {
    requireAuth(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const svc = await fastify.ctx.db
      .selectFrom('services')
      .select(['id', 'slug', 'archived_at'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!svc) return reply.code(404).send({ error: 'not found' });
    if (svc.archived_at) return reply.code(409).send({ error: 'already archived' });

    // Archiving == stop all containers, hide from list. Data volumes preserved —
    // hard delete is a separate, deliberate action we haven't built yet.
    await fastify.ctx.db
      .updateTable('services')
      .set({ desired_state: 'archived', archived_at: new Date() })
      .where('id', '=', id)
      .execute();
    await recordAudit(fastify.ctx.db, req, {
      action: 'service.archive',
      target_kind: 'service',
      target_id: id,
      payload: { slug: svc.slug },
    });
    fastify.ctx.reconciler.reconcileSoon(id);
    return reply.send({ ok: true });
  });

  fastify.post('/services/:id/stop', async (req, reply) => {
    requireAuth(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await fastify.ctx.db.updateTable('services').set({ desired_state: 'stopped' }).where('id', '=', id).execute();
    await recordAudit(fastify.ctx.db, req, { action: 'service.stop', target_kind: 'service', target_id: id });
    fastify.ctx.reconciler.reconcileSoon(id);
    return reply.send({ ok: true });
  });

  fastify.post('/services/:id/start', async (req, reply) => {
    requireAuth(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await fastify.ctx.db.updateTable('services').set({ desired_state: 'running' }).where('id', '=', id).execute();
    await recordAudit(fastify.ctx.db, req, { action: 'service.start', target_kind: 'service', target_id: id });
    fastify.ctx.reconciler.reconcileSoon(id);
    return reply.send({ ok: true });
  });
}

