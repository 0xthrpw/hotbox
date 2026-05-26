import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { CreateServiceInputSchema, CreateDeploymentInputSchema } from '@hotbox/shared';
import { seal, type KeyRing } from '@hotbox/crypto';
import type { CreateServiceInput } from '@hotbox/shared';
import type { HotboxDb, NetworkRef, SecretRef } from '@hotbox/db';
import { requireAuth } from './auth.js';
import { recordAudit } from '../audit.js';

interface SiblingPlanResult {
  parentNetworkRefs: NetworkRef[];
  parentSecretRefs: SecretRef[];
  parentExtraEnv: Record<string, string>;
  siblingIds: string[];
}

export async function servicesRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/services', async (req) => {
    requireAuth(req);
    const rows = await fastify.ctx.db
      .selectFrom('services')
      .selectAll()
      .where('host_id', '=', fastify.ctx.hostId)
      .where('archived_at', 'is', null)
      // hide managed siblings from the top-level list — they appear under their parent
      .where('parent_service_id', 'is', null)
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
    const existing = await fastify.ctx.db
      .selectFrom('services')
      .select('id')
      .where('slug', '=', input.slug)
      .executeTakeFirst();
    if (existing) return reply.code(409).send({ error: 'slug taken' });

    const requires = input.config?.requires ?? [];
    for (const r of requires) {
      const siblingSlug = `${input.slug}-${r.name}`;
      const dup = await fastify.ctx.db
        .selectFrom('services')
        .select('id')
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
        parent: { id: svc.id, slug: svc.slug, name: svc.name, hostId: fastify.ctx.hostId },
        requires,
        keyring: fastify.ctx.keyring,
        createdBy: req.user.id,
      });
    }

    const deployment = await fastify.ctx.db
      .insertInto('deployments')
      .values({
        service_id: svc.id,
        version: 1,
        image: input.image,
        env_snapshot: { ...input.env, ...sibling.parentExtraEnv },
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
    const env = input.env ?? ((latest?.env_snapshot as Record<string, string> | undefined) ?? {});

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
 */
async function createSiblings(opts: {
  db: HotboxDb;
  parent: { id: string; slug: string; name: string; hostId: string };
  requires: NonNullable<NonNullable<CreateServiceInput['config']>['requires']>;
  keyring: KeyRing;
  createdBy: string;
}): Promise<SiblingPlanResult> {
  const { db, parent, requires, keyring, createdBy } = opts;
  const sharedNetwork = `${parent.slug}-net`;
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
