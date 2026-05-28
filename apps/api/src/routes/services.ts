import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { CreateServiceInputSchema, CreateDeploymentInputSchema } from '@hotbox/shared';
import { seal, type KeyRing } from '@hotbox/crypto';
import type { CreateServiceInput } from '@hotbox/shared';
import type { HotboxDb, NetworkRef, SecretRef } from '@hotbox/db';
import { requireAuth } from './auth.js';
import { recordAudit } from '../audit.js';
import { resolveVariables } from '../lib/resolve-variables.js';

interface SiblingPlanResult {
  parentNetworkRefs: NetworkRef[];
  parentSecretRefs: SecretRef[];
  parentExtraEnv: Record<string, string>;
  siblingIds: string[];
}

const ListServicesQuerySchema = z.object({
  projectId: z.string().uuid().optional(),
  environmentId: z.string().uuid().optional(),
});

export async function servicesRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/services', async (req) => {
    requireAuth(req);
    const { projectId, environmentId } = ListServicesQuerySchema.parse(req.query ?? {});
    let q = fastify.ctx.db
      .selectFrom('services')
      .innerJoin('projects', 'projects.id', 'services.project_id')
      .innerJoin('environments', 'environments.id', 'services.environment_id')
      .select([
        'services.id', 'services.slug', 'services.name', 'services.host_id',
        'services.project_id', 'services.environment_id', 'services.kind',
        'services.desired_state', 'services.current_state', 'services.hostname',
        'services.public_port', 'services.config', 'services.template',
        'services.owner_id', 'services.parent_service_id',
        'services.created_at', 'services.updated_at', 'services.archived_at',
        'projects.slug as project_slug', 'projects.name as project_name',
        'environments.slug as environment_slug', 'environments.name as environment_name',
      ])
      .where('services.host_id', '=', fastify.ctx.hostId)
      .where('services.archived_at', 'is', null)
      // hide managed siblings from the top-level list — they appear under their parent
      .where('services.parent_service_id', 'is', null)
      .orderBy('services.created_at', 'desc');
    if (projectId) q = q.where('services.project_id', '=', projectId);
    if (environmentId) q = q.where('services.environment_id', '=', environmentId);
    const rows = await q.execute();
    return { services: rows };
  });

  fastify.get('/services/:id', async (req, reply) => {
    requireAuth(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const svc = await fastify.ctx.db
      .selectFrom('services')
      .innerJoin('projects', 'projects.id', 'services.project_id')
      .innerJoin('environments', 'environments.id', 'services.environment_id')
      .select([
        'services.id', 'services.slug', 'services.name', 'services.host_id',
        'services.project_id', 'services.environment_id', 'services.kind',
        'services.desired_state', 'services.current_state', 'services.hostname',
        'services.public_port', 'services.config', 'services.template',
        'services.owner_id', 'services.parent_service_id',
        'services.created_at', 'services.updated_at', 'services.archived_at',
        'projects.slug as project_slug', 'projects.name as project_name',
        'environments.slug as environment_slug', 'environments.name as environment_name',
      ])
      .where('services.id', '=', id)
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
    const siblings = await fastify.ctx.db
      .selectFrom('services')
      .selectAll()
      .where('parent_service_id', '=', id)
      .where('archived_at', 'is', null)
      .execute();
    return { service: svc, deployments, containers, siblings };
  });

  fastify.post('/services', async (req, reply) => {
    requireAuth(req);
    const input = CreateServiceInputSchema.parse(req.body);

    // Verify the env belongs to the named project — prevents an attacker
    // (or a buggy UI) from creating a service in env X while claiming it
    // belongs to unrelated project Y. Single lookup serves both checks.
    const env = await fastify.ctx.db
      .selectFrom('environments')
      .innerJoin('projects', 'projects.id', 'environments.project_id')
      .select([
        'environments.id as env_id',
        'environments.slug as env_slug',
        'projects.id as project_id',
        'projects.slug as project_slug',
        'projects.name as project_name',
        'projects.archived_at as project_archived_at',
      ])
      .where('environments.id', '=', input.environment_id)
      .executeTakeFirst();
    if (!env || env.project_id !== input.project_id) {
      return reply.code(400).send({ error: 'environment does not belong to project' });
    }
    if (env.project_archived_at) {
      return reply.code(400).send({ error: 'project is archived' });
    }

    const existing = await fastify.ctx.db
      .selectFrom('services')
      .select('id')
      .where('project_id', '=', input.project_id)
      .where('environment_id', '=', input.environment_id)
      .where('slug', '=', input.slug)
      .executeTakeFirst();
    if (existing) return reply.code(409).send({ error: 'slug taken' });

    const requires = input.config?.requires ?? [];
    for (const r of requires) {
      const siblingSlug = `${input.slug}-${r.name}`;
      const dup = await fastify.ctx.db
        .selectFrom('services')
        .select('id')
        .where('project_id', '=', input.project_id)
        .where('environment_id', '=', input.environment_id)
        .where('slug', '=', siblingSlug)
        .executeTakeFirst();
      if (dup) return reply.code(409).send({ error: `slug taken: ${siblingSlug}` });
    }

    const svc = await fastify.ctx.db
      .insertInto('services')
      .values({
        slug: input.slug,
        name: input.name,
        host_id: fastify.ctx.hostId,
        project_id: input.project_id,
        environment_id: input.environment_id,
        kind: input.kind,
        hostname: input.hostname ?? null,
        public_port: input.public_port ?? null,
        config: input.config,
        template: input.template ?? null,
        owner_id: req.user.id,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    let sibling: SiblingPlanResult = {
      parentNetworkRefs: [],
      parentSecretRefs: [],
      parentExtraEnv: {},
      siblingIds: [],
    };
    if (requires.length > 0) {
      sibling = await createSiblings({
        db: fastify.ctx.db,
        parent: {
          id: svc.id,
          slug: svc.slug,
          name: svc.name,
          hostId: fastify.ctx.hostId,
          projectId: input.project_id,
          projectSlug: env.project_slug,
          environmentId: input.environment_id,
          environmentSlug: env.env_slug,
        },
        requires,
        keyring: fastify.ctx.keyring,
        createdBy: req.user.id,
      });
    }

    // Form-supplied env vars and secrets become first-class service-scoped
    // variable rows so they show up in the Variables UI and so resolveVariables
    // returns them on subsequent redeploys. Project/env-level overrides will
    // win over these once the operator adds them at those scopes.
    for (const [key, value] of Object.entries(input.env)) {
      await fastify.ctx.db.insertInto('variables').values({
        service_id: svc.id,
        scope: 'service',
        key,
        value,
        is_secret: false,
        ciphertext: null,
        nonce: null,
        key_version: null,
        project_id: null,
        environment_id: null,
      }).execute();
    }
    for (const [key, value] of Object.entries(input.secrets)) {
      const sealed = seal(fastify.ctx.keyring, value);
      await fastify.ctx.db.insertInto('variables').values({
        service_id: svc.id,
        scope: 'service',
        key,
        value: null,
        is_secret: true,
        ciphertext: sealed.ciphertext,
        nonce: sealed.nonce,
        key_version: sealed.keyVersion,
        project_id: null,
        environment_id: null,
      }).execute();
    }

    // Resolve the full merged map for env_snapshot. Sibling-supplied plain
    // env (Redis URLs etc.) wins over user variables for the same key, since
    // overriding sibling wiring would silently break the service.
    const resolved = await resolveVariables(fastify.ctx.db, fastify.ctx.keyring, svc.id);
    const deployment = await fastify.ctx.db
      .insertInto('deployments')
      .values({
        service_id: svc.id,
        version: 1,
        image: input.image,
        env_snapshot: { ...resolved, ...sibling.parentExtraEnv },
        secret_refs: sibling.parentSecretRefs,
        network_refs: sibling.parentNetworkRefs,
        created_by: req.user.id,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await recordAudit(fastify.ctx.db, req, {
      action: 'service.create',
      target_kind: 'service',
      target_id: svc.id,
      payload: {
        slug: svc.slug,
        project_id: svc.project_id,
        environment_id: svc.environment_id,
        template: svc.template,
        image: input.image,
        siblings: sibling.siblingIds,
      },
    });

    fastify.ctx.reconciler.reconcileSoon(svc.id);
    for (const sid of sibling.siblingIds) fastify.ctx.reconciler.reconcileSoon(sid);
    return { service: svc, deployment, siblings: sibling.siblingIds };
  });

  fastify.post('/services/:id/deployments', async (req, reply) => {
    requireAuth(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    // Redeploy from the UI sends no body; all fields are optional, treat
    // missing body as the empty object so Zod doesn't reject `null`.
    const input = CreateDeploymentInputSchema.parse(req.body ?? {});
    const svc = await fastify.ctx.db
      .selectFrom('services')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!svc) return reply.code(404).send({ error: 'not found' });

    const latest = await fastify.ctx.db
      .selectFrom('deployments')
      .select(['version', 'image', 'env_snapshot', 'secret_refs', 'network_refs'])
      .where('service_id', '=', id)
      .orderBy('version', 'desc')
      .executeTakeFirst();

    const image = input.image ?? latest?.image;
    if (!image) return reply.code(400).send({ error: 'no previous deployment to reuse image from' });

    // Redeploy snapshot strategy:
    //   - body.env explicitly provided  → use it verbatim (one-off override path)
    //   - body.env omitted              → re-resolve variables so this deploy
    //                                     picks up any project/env/service var
    //                                     changes since the last deployment
    // Carrying forward latest.env_snapshot (the old behavior) would silently
    // ignore variable edits — the whole point of variables is that editing
    // them and clicking redeploy applies the change.
    const env = input.env ?? (await resolveVariables(fastify.ctx.db, fastify.ctx.keyring, id));

    const deployment = await fastify.ctx.db
      .insertInto('deployments')
      .values({
        service_id: id,
        version: (latest?.version ?? 0) + 1,
        image,
        env_snapshot: env,
        // Carry forward the wiring (secret refs, network refs) — a redeploy
        // should not drop the link to managed siblings.
        secret_refs: (latest?.secret_refs as SecretRef[] | undefined) ?? [],
        network_refs: (latest?.network_refs as NetworkRef[] | undefined) ?? [],
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

/**
 * Compute the shared docker network name that links a parent service to its
 * managed siblings. Scoped by (project, env, parent slug) so that the same
 * service slug can exist in multiple envs without their networks colliding
 * on the host.
 */
export function siblingNetworkName(opts: {
  projectSlug: string;
  environmentSlug: string;
  parentSlug: string;
}): string {
  return `${opts.projectSlug}-${opts.environmentSlug}-${opts.parentSlug}-net`;
}

/**
 * For each `requires` entry on a parent service, create the sibling service
 * row + its initial deployment + the encrypted secrets that wire the parent
 * to the sibling.
 *
 * Postgres siblings get:
 *   - random password (24 base64url chars), encrypted into `secrets` scoped
 *     to the sibling. Sibling deployment references it as POSTGRES_PASSWORD.
 *   - `<NAME>_URL=postgres://app:<pw>@<sibling-slug>:5432/app` encrypted into
 *     `secrets` scoped to the parent. Parent deployment references it.
 *
 * Redis siblings have no auth (the shared network is internal) — we inject a
 * plain `<NAME>_URL=redis://<sibling-slug>:6379/0` into the parent's env.
 *
 * NOTE: the connection URL uses the parent's slug-based hostname (e.g.
 * `myapp-db`) — Docker's DNS resolves it through the shared network. The
 * shared network name itself includes project+env to stay unique on the host,
 * but service-to-service DNS within the network only needs the sibling slug
 * (which is also slug-based, prefixed by the parent slug).
 */
export async function createSiblings(opts: {
  db: HotboxDb;
  parent: {
    id: string;
    slug: string;
    name: string;
    hostId: string;
    projectId: string;
    projectSlug: string;
    environmentId: string;
    environmentSlug: string;
  };
  requires: NonNullable<NonNullable<CreateServiceInput['config']>['requires']>;
  keyring: KeyRing;
  createdBy: string;
}): Promise<SiblingPlanResult> {
  const { db, parent, requires, keyring, createdBy } = opts;
  const sharedNetwork = siblingNetworkName({
    projectSlug: parent.projectSlug,
    environmentSlug: parent.environmentSlug,
    parentSlug: parent.slug,
  });
  const parentNetworkRefs: NetworkRef[] = [{ name: sharedNetwork, internal: true }];
  const parentSecretRefs: SecretRef[] = [];
  const parentExtraEnv: Record<string, string> = {};
  const siblingIds: string[] = [];

  for (const req of requires) {
    const siblingSlug = `${parent.slug}-${req.name}`;
    const template = req.kind === 'postgres' ? 'managed-postgres' : 'managed-redis';
    const sibling = await db
      .insertInto('services')
      .values({
        slug: siblingSlug,
        name: `${parent.name} — ${req.name}`,
        host_id: parent.hostId,
        project_id: parent.projectId,
        environment_id: parent.environmentId,
        kind: req.kind === 'postgres' ? 'managed_pg' : 'managed_redis',
        parent_service_id: parent.id,
        template,
        owner_id: createdBy,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    siblingIds.push(sibling.id);

    if (req.kind === 'postgres') {
      const password = randomBytes(24).toString('base64url');

      const sealedPw = seal(keyring, password);
      const pwSecret = await db
        .insertInto('secrets')
        .values({
          service_id: sibling.id,
          key: 'POSTGRES_PASSWORD',
          ciphertext: sealedPw.ciphertext,
          nonce: sealedPw.nonce,
          key_version: sealedPw.keyVersion,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const url = `postgres://app:${password}@${siblingSlug}:5432/app`;
      const envName = `${req.name.toUpperCase()}_URL`;
      const sealedUrl = seal(keyring, url);
      const urlSecret = await db
        .insertInto('secrets')
        .values({
          service_id: parent.id,
          key: envName,
          ciphertext: sealedUrl.ciphertext,
          nonce: sealedUrl.nonce,
          key_version: sealedUrl.keyVersion,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      parentSecretRefs.push({ secret_id: urlSecret.id, inject_as: 'env', key: envName });

      await db
        .insertInto('deployments')
        .values({
          service_id: sibling.id,
          version: 1,
          image: 'postgres:16-alpine',
          env_snapshot: {},
          secret_refs: [{ secret_id: pwSecret.id, inject_as: 'env', key: 'POSTGRES_PASSWORD' }],
          network_refs: [{ name: sharedNetwork, internal: true }],
          created_by: createdBy,
        })
        .execute();
    } else {
      const envName = `${req.name.toUpperCase()}_URL`;
      parentExtraEnv[envName] = `redis://${siblingSlug}:6379/0`;
      await db
        .insertInto('deployments')
        .values({
          service_id: sibling.id,
          version: 1,
          image: 'redis:7-alpine',
          env_snapshot: {},
          network_refs: [{ name: sharedNetwork, internal: true }],
          created_by: createdBy,
        })
        .execute();
    }
  }

  return { parentNetworkRefs, parentSecretRefs, parentExtraEnv, siblingIds };
}
