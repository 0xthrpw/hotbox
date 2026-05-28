import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  CreateProjectInputSchema,
  CreateEnvironmentInputSchema,
  DuplicateEnvironmentInputSchema,
} from '@hotbox/shared';
import { requireAuth } from './auth.js';
import { recordAudit } from '../audit.js';
import { createSiblings } from './services.js';

export async function projectsRoutes(fastify: FastifyInstance): Promise<void> {
  // -------------------------------------------------------------------------
  // Projects
  // -------------------------------------------------------------------------
  fastify.get('/projects', async (req) => {
    requireAuth(req);
    const projects = await fastify.ctx.db
      .selectFrom('projects')
      .selectAll()
      .where('archived_at', 'is', null)
      .orderBy('created_at', 'desc')
      .execute();
    const envs = projects.length === 0
      ? []
      : await fastify.ctx.db
          .selectFrom('environments')
          .selectAll()
          .where('project_id', 'in', projects.map((p) => p.id))
          .orderBy('created_at', 'asc')
          .execute();
    const envsByProject = new Map<string, typeof envs>();
    for (const e of envs) {
      const arr = envsByProject.get(e.project_id) ?? [];
      arr.push(e);
      envsByProject.set(e.project_id, arr);
    }
    return {
      projects: projects.map((p) => ({ ...p, environments: envsByProject.get(p.id) ?? [] })),
    };
  });

  fastify.post('/projects', async (req, reply) => {
    requireAuth(req);
    const input = CreateProjectInputSchema.parse(req.body);
    const dup = await fastify.ctx.db
      .selectFrom('projects')
      .select('id')
      .where('slug', '=', input.slug)
      .executeTakeFirst();
    if (dup) return reply.code(409).send({ error: 'slug taken' });

    const project = await fastify.ctx.db
      .insertInto('projects')
      .values({ slug: input.slug, name: input.name, owner_id: req.user.id })
      .returningAll()
      .executeTakeFirstOrThrow();
    await recordAudit(fastify.ctx.db, req, {
      action: 'project.create',
      target_kind: 'project',
      target_id: project.id,
      payload: { slug: project.slug, name: project.name },
    });
    return { project };
  });

  fastify.get('/projects/:id', async (req, reply) => {
    requireAuth(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const project = await fastify.ctx.db
      .selectFrom('projects')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!project) return reply.code(404).send({ error: 'not found' });

    const environments = await fastify.ctx.db
      .selectFrom('environments')
      .selectAll()
      .where('project_id', '=', id)
      .orderBy('created_at', 'asc')
      .execute();

    // Per-env service counts (parent services only — siblings hide under parent).
    const counts = environments.length === 0
      ? []
      : await fastify.ctx.db
          .selectFrom('services')
          .select(({ fn }) => ['environment_id', fn.countAll<string>().as('count')])
          .where('environment_id', 'in', environments.map((e) => e.id))
          .where('archived_at', 'is', null)
          .where('parent_service_id', 'is', null)
          .groupBy('environment_id')
          .execute();
    const countByEnv = new Map(counts.map((c) => [c.environment_id, Number(c.count)]));

    return {
      project,
      environments: environments.map((e) => ({ ...e, service_count: countByEnv.get(e.id) ?? 0 })),
    };
  });

  fastify.delete('/projects/:id', async (req, reply) => {
    requireAuth(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const project = await fastify.ctx.db
      .selectFrom('projects')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!project) return reply.code(404).send({ error: 'not found' });

    const nonEmpty = await fastify.ctx.db
      .selectFrom('services')
      .select('id')
      .where('project_id', '=', id)
      .where('archived_at', 'is', null)
      .limit(1)
      .executeTakeFirst();
    if (nonEmpty) {
      return reply.code(409).send({ error: 'project has services; archive or delete them first' });
    }

    // Soft delete — the FK from services / environments uses ON DELETE RESTRICT,
    // so a hard delete is blocked if anything (even archived) references it.
    // Soft-deleting matches the existing 'archive' semantics on services.
    await fastify.ctx.db
      .updateTable('projects')
      .set({ archived_at: new Date() })
      .where('id', '=', id)
      .execute();
    await recordAudit(fastify.ctx.db, req, {
      action: 'project.archive',
      target_kind: 'project',
      target_id: id,
      payload: { slug: project.slug },
    });
    return reply.send({ ok: true });
  });

  // -------------------------------------------------------------------------
  // Environments (nested under projects)
  // -------------------------------------------------------------------------
  fastify.get('/projects/:id/environments', async (req, reply) => {
    requireAuth(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const project = await fastify.ctx.db
      .selectFrom('projects').select('id').where('id', '=', id).executeTakeFirst();
    if (!project) return reply.code(404).send({ error: 'not found' });
    const environments = await fastify.ctx.db
      .selectFrom('environments')
      .selectAll()
      .where('project_id', '=', id)
      .orderBy('created_at', 'asc')
      .execute();
    return { environments };
  });

  fastify.post('/projects/:id/environments', async (req, reply) => {
    requireAuth(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const input = CreateEnvironmentInputSchema.parse(req.body);
    const project = await fastify.ctx.db
      .selectFrom('projects')
      .select(['id', 'slug', 'archived_at'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!project) return reply.code(404).send({ error: 'not found' });
    if (project.archived_at) return reply.code(409).send({ error: 'project is archived' });

    const dup = await fastify.ctx.db
      .selectFrom('environments')
      .select('id')
      .where('project_id', '=', id)
      .where('slug', '=', input.slug)
      .executeTakeFirst();
    if (dup) return reply.code(409).send({ error: 'slug taken in project' });

    const env = await fastify.ctx.db
      .insertInto('environments')
      .values({ project_id: id, slug: input.slug, name: input.name })
      .returningAll()
      .executeTakeFirstOrThrow();
    await recordAudit(fastify.ctx.db, req, {
      action: 'environment.create',
      target_kind: 'environment',
      target_id: env.id,
      payload: { project_id: id, slug: env.slug, name: env.name },
    });
    return { environment: env };
  });

  fastify.post('/projects/:id/environments/:envId/duplicate', async (req, reply) => {
    requireAuth(req);
    const { id, envId } = z
      .object({ id: z.string().uuid(), envId: z.string().uuid() })
      .parse(req.params);
    const input = DuplicateEnvironmentInputSchema.parse(req.body);

    const source = await fastify.ctx.db
      .selectFrom('environments')
      .innerJoin('projects', 'projects.id', 'environments.project_id')
      .select([
        'environments.id as env_id',
        'environments.slug as env_slug',
        'environments.project_id',
        'projects.slug as project_slug',
        'projects.name as project_name',
        'projects.archived_at as project_archived_at',
      ])
      .where('environments.id', '=', envId)
      .executeTakeFirst();
    if (!source || source.project_id !== id) {
      return reply.code(404).send({ error: 'environment not found in project' });
    }
    if (source.project_archived_at) {
      return reply.code(409).send({ error: 'project is archived' });
    }

    const dup = await fastify.ctx.db
      .selectFrom('environments')
      .select('id')
      .where('project_id', '=', id)
      .where('slug', '=', input.slug)
      .executeTakeFirst();
    if (dup) return reply.code(409).send({ error: 'target slug taken in project' });

    // Snapshot the source env's top-level services and their latest deployment.
    // Siblings are recreated fresh in the target env by createSiblings (new
    // passwords, new secrets) — copying them as plain rows would also copy
    // the stale parent-to-sibling secret refs, which would point at the
    // wrong (source-env) sibling slugs in the new env's shared network.
    const sourceServices = await fastify.ctx.db
      .selectFrom('services')
      .selectAll()
      .where('environment_id', '=', envId)
      .where('archived_at', 'is', null)
      .where('parent_service_id', 'is', null)
      .execute();

    const newEnv = await fastify.ctx.db
      .insertInto('environments')
      .values({ project_id: id, slug: input.slug, name: input.name })
      .returningAll()
      .executeTakeFirstOrThrow();

    const newServiceIds: string[] = [];
    for (const src of sourceServices) {
      const latest = await fastify.ctx.db
        .selectFrom('deployments')
        .selectAll()
        .where('service_id', '=', src.id)
        .orderBy('version', 'desc')
        .executeTakeFirst();
      if (!latest) continue;

      const newSvc = await fastify.ctx.db
        .insertInto('services')
        .values({
          slug: src.slug,
          name: src.name,
          host_id: src.host_id,
          project_id: id,
          environment_id: newEnv.id,
          kind: src.kind,
          hostname: src.hostname,
          public_port: src.public_port,
          config: src.config,
          template: src.template,
          owner_id: req.user.id,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      newServiceIds.push(newSvc.id);

      // Re-mint managed siblings in the new env (fresh passwords + secrets).
      // Plain env vars (latest.env_snapshot) carry through verbatim so the new
      // service starts with the same configuration; the only thing that
      // changes is the wiring to its siblings.
      const requires = (src.config?.requires as
        | NonNullable<typeof src.config>['requires']
        | undefined) ?? [];
      let sibling = {
        parentNetworkRefs: [] as Array<{ name: string; internal?: boolean }>,
        parentSecretRefs: [] as Array<{ secret_id: string; inject_as: 'env' | 'file'; key?: string }>,
        parentExtraEnv: {} as Record<string, string>,
        siblingIds: [] as string[],
      };
      if (requires.length > 0) {
        sibling = await createSiblings({
          db: fastify.ctx.db,
          parent: {
            id: newSvc.id,
            slug: newSvc.slug,
            name: newSvc.name,
            hostId: src.host_id,
            projectId: id,
            projectSlug: source.project_slug,
            environmentId: newEnv.id,
            environmentSlug: newEnv.slug,
          },
          requires,
          keyring: fastify.ctx.keyring,
          createdBy: req.user.id,
        });
        for (const sid of sibling.siblingIds) newServiceIds.push(sid);
      }

      const envSnapshot = {
        ...(latest.env_snapshot as Record<string, string>),
        ...sibling.parentExtraEnv,
      };
      await fastify.ctx.db
        .insertInto('deployments')
        .values({
          service_id: newSvc.id,
          version: 1,
          image: latest.image,
          env_snapshot: envSnapshot,
          secret_refs: sibling.parentSecretRefs,
          network_refs: sibling.parentNetworkRefs,
          // Volume refs intentionally NOT copied — duplicate is config-only,
          // fresh state. Each new service gets empty volumes.
          created_by: req.user.id,
        })
        .execute();
    }

    await recordAudit(fastify.ctx.db, req, {
      action: 'environment.duplicate',
      target_kind: 'environment',
      target_id: newEnv.id,
      payload: {
        source_environment_id: envId,
        project_id: id,
        slug: newEnv.slug,
        service_count: newServiceIds.length,
      },
    });

    for (const sid of newServiceIds) fastify.ctx.reconciler.reconcileSoon(sid);
    return { environment: newEnv, services_created: newServiceIds };
  });

  fastify.delete('/projects/:id/environments/:envId', async (req, reply) => {
    requireAuth(req);
    const { id, envId } = z
      .object({ id: z.string().uuid(), envId: z.string().uuid() })
      .parse(req.params);
    const env = await fastify.ctx.db
      .selectFrom('environments')
      .selectAll()
      .where('id', '=', envId)
      .executeTakeFirst();
    if (!env || env.project_id !== id) {
      return reply.code(404).send({ error: 'environment not found in project' });
    }
    const occupant = await fastify.ctx.db
      .selectFrom('services')
      .select('id')
      .where('environment_id', '=', envId)
      .where('archived_at', 'is', null)
      .limit(1)
      .executeTakeFirst();
    if (occupant) {
      return reply.code(409).send({ error: 'environment has services; archive them first' });
    }

    // Hard delete is safe here — we just confirmed no live services reference
    // this env. Archived services hold an FK reference, so we must purge them
    // first. Use a transaction so an FK violation rolls cleanly.
    await fastify.ctx.db.transaction().execute(async (trx) => {
      await trx
        .deleteFrom('services')
        .where('environment_id', '=', envId)
        .where('archived_at', 'is not', null)
        .execute();
      await trx.deleteFrom('environments').where('id', '=', envId).execute();
    });

    await recordAudit(fastify.ctx.db, req, {
      action: 'environment.delete',
      target_kind: 'environment',
      target_id: envId,
      payload: { project_id: id, slug: env.slug },
    });
    return reply.send({ ok: true });
  });
}
