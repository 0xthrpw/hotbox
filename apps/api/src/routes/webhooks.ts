import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { HotboxDb } from '@hotbox/db';
import { recordAudit } from '../audit.js';

/**
 * GitHub push-webhook receivers (Phase 4b). Two flavors:
 *   - /webhooks/github/:sourceId — per-source secret, pasted into the repo's
 *     webhook settings by hand.
 *   - /webhooks/github-app — one endpoint for every repo the App covers,
 *     signed with the app-level secret; fans out to all matching sources.
 * Registered OUTSIDE the /api session scope: callers are GitHub, not
 * browsers, and authentication is the HMAC signature, never a cookie.
 *
 * Every verified delivery is recorded in webhook_deliveries (pruned to the
 * newest ~50 per source) so the dashboard can answer "why didn't my push
 * build?". Per-source signature mismatches are recorded too (the source is
 * known from the URL); app-level mismatches aren't attributable to a source
 * and are left to GitHub's own delivery log.
 */

/** GitHub caps webhook payloads at 25 MB; push payloads are far smaller. */
const WEBHOOK_BODY_LIMIT = 5 * 1024 * 1024;

const DELIVERIES_KEPT_PER_SOURCE = 50;

/** Constant-time check of GitHub's `x-hub-signature-256: sha256=<hex>` header. */
export function verifyGithubSignature(
  secret: string,
  rawBody: Buffer,
  signatureHeader: string | undefined,
): boolean {
  if (!signatureHeader?.startsWith('sha256=')) return false;
  const theirs = Buffer.from(signatureHeader.slice('sha256='.length), 'hex');
  const ours = createHmac('sha256', secret).update(rawBody).digest();
  return theirs.length === ours.length && timingSafeEqual(theirs, ours);
}

export interface PushDecision {
  action: 'build' | 'ignore';
  reason?: string;
}

/**
 * Decide whether a delivery should queue a build. Only pushes to the exact
 * configured branch build; branch deletions and pushes whose head we already
 * built (e.g. GitHub redelivery of an old event) are ignored.
 */
export function evaluatePushEvent(
  source: { branch: string; last_built_sha: string | null },
  event: string,
  payload: { ref?: string; deleted?: boolean; head_commit?: { id?: string } | null },
): PushDecision {
  if (event !== 'push') return { action: 'ignore', reason: 'unsupported-event' };
  if (payload.deleted) return { action: 'ignore', reason: 'branch-deleted' };
  if (payload.ref !== `refs/heads/${source.branch}`) {
    return { action: 'ignore', reason: 'ref-mismatch' };
  }
  if (payload.head_commit?.id && payload.head_commit.id === source.last_built_sha) {
    return { action: 'ignore', reason: 'already-built' };
  }
  return { action: 'build' };
}

function headerValue(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

interface DeliveryRow {
  github_source_id: string;
  via: 'source' | 'app';
  delivery_id: string | null;
  event: string;
  ref?: string | null;
  head_sha?: string | null;
  action: 'build' | 'ignore' | 'rejected';
  reason?: string | null;
  build_id?: string | null;
}

/** Best-effort: the delivery log must never fail or slow a webhook response. */
async function recordDelivery(db: HotboxDb, row: DeliveryRow): Promise<void> {
  try {
    await db
      .insertInto('webhook_deliveries')
      .values({
        github_source_id: row.github_source_id,
        via: row.via,
        delivery_id: row.delivery_id,
        event: row.event,
        ref: row.ref ?? null,
        head_sha: row.head_sha ?? null,
        action: row.action,
        reason: row.reason ?? null,
        build_id: row.build_id ?? null,
      })
      .execute();
    await db
      .deleteFrom('webhook_deliveries')
      .where('github_source_id', '=', row.github_source_id)
      .where('id', 'not in', (eb) =>
        eb
          .selectFrom('webhook_deliveries')
          .select('id')
          .where('github_source_id', '=', row.github_source_id)
          .orderBy('created_at', 'desc')
          .limit(DELIVERIES_KEPT_PER_SOURCE),
      )
      .execute();
  } catch {
    // Display metadata only — swallow.
  }
}

interface PushPayload {
  ref?: string;
  deleted?: boolean;
  head_commit?: { id?: string } | null;
}

interface SourceRow {
  id: string;
  service_id: string;
  branch: string;
  last_built_sha: string | null;
}

/** Shared per-source push handling: decide, coalesce, enqueue, record. */
async function processPush(
  fastify: FastifyInstance,
  req: FastifyRequest,
  source: SourceRow,
  event: string,
  payload: PushPayload,
  via: 'source' | 'app',
  deliveryId: string | null,
): Promise<{ source_id: string; queued: boolean; reason?: string; build_id?: string }> {
  const base = {
    github_source_id: source.id,
    via,
    delivery_id: deliveryId,
    event,
    ref: payload.ref ?? null,
    head_sha: payload.head_commit?.id ?? null,
  };

  const decision = evaluatePushEvent(source, event, payload);
  if (decision.action === 'ignore') {
    await recordDelivery(fastify.ctx.db, { ...base, action: 'ignore', reason: decision.reason });
    return { source_id: source.id, queued: false, reason: decision.reason };
  }

  // Coalesce: a queued build already picks up the branch head when the
  // worker clones, so stacking a second row per push would only make the
  // serial builder rebuild the same sha twice.
  const queued = await fastify.ctx.db
    .selectFrom('builds')
    .select('id')
    .where('github_source_id', '=', source.id)
    .where('status', '=', 'queued')
    .executeTakeFirst();
  if (queued) {
    await recordDelivery(fastify.ctx.db, {
      ...base,
      action: 'ignore',
      reason: 'already-queued',
      build_id: queued.id,
    });
    return { source_id: source.id, queued: false, reason: 'already-queued', build_id: queued.id };
  }

  const build = await fastify.ctx.db
    .insertInto('builds')
    .values({
      github_source_id: source.id,
      service_id: source.service_id,
      triggered_by: 'webhook',
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  await recordAudit(fastify.ctx.db, req, {
    action: 'build.create',
    target_kind: 'service',
    target_id: source.service_id,
    payload: {
      build_id: build.id,
      triggered_by: 'webhook',
      branch: source.branch,
      head_commit: payload.head_commit?.id ?? null,
      via,
    },
  });
  await recordDelivery(fastify.ctx.db, { ...base, action: 'build', build_id: build.id });

  return { source_id: source.id, queued: true, build_id: build.id };
}

export async function webhooksRoutes(fastify: FastifyInstance): Promise<void> {
  // The HMAC must be computed over the exact bytes GitHub sent, so keep the
  // raw buffer instead of parsed JSON. addContentTypeParser is encapsulated
  // to this plugin scope — /api routes keep the default JSON parser.
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer', bodyLimit: WEBHOOK_BODY_LIMIT },
    (_req, body, done) => done(null, body),
  );

  fastify.post('/webhooks/github/:sourceId', async (req, reply) => {
    const params = z.object({ sourceId: z.string().uuid() }).safeParse(req.params);
    if (!params.success) return reply.code(404).send({ error: 'not found' });

    // A source without a secret has webhooks disabled — indistinguishable
    // from a nonexistent source on purpose.
    const source = await fastify.ctx.db
      .selectFrom('github_sources')
      .selectAll()
      .where('id', '=', params.data.sourceId)
      .executeTakeFirst();
    if (!source?.webhook_secret) return reply.code(404).send({ error: 'not found' });

    const deliveryId = headerValue(req.headers['x-github-delivery']) ?? null;
    const event = headerValue(req.headers['x-github-event']) ?? '';

    const raw = req.body as Buffer;
    const signature = headerValue(req.headers['x-hub-signature-256']);
    if (!verifyGithubSignature(source.webhook_secret, raw, signature)) {
      // The source is known from the URL, so a wrong secret IS attributable —
      // exactly the case the dashboard log exists to surface.
      await recordDelivery(fastify.ctx.db, {
        github_source_id: source.id,
        via: 'source',
        delivery_id: deliveryId,
        event: event || 'unknown',
        action: 'rejected',
        reason: 'signature-mismatch',
      });
      return reply.code(401).send({ error: 'signature mismatch' });
    }

    if (event === 'ping') {
      await recordDelivery(fastify.ctx.db, {
        github_source_id: source.id,
        via: 'source',
        delivery_id: deliveryId,
        event,
        action: 'ignore',
        reason: 'ping',
      });
      return { ok: true, pong: true };
    }

    let payload: PushPayload;
    try {
      payload = JSON.parse(raw.toString('utf8'));
    } catch {
      await recordDelivery(fastify.ctx.db, {
        github_source_id: source.id,
        via: 'source',
        delivery_id: deliveryId,
        event,
        action: 'rejected',
        reason: 'invalid-json',
      });
      return reply.code(400).send({ error: 'invalid JSON payload' });
    }

    const result = await processPush(fastify, req, source, event, payload, 'source', deliveryId);
    if (result.queued) {
      fastify.ctx.buildWorker.kick();
      return reply.code(201).send({ queued: true, build_id: result.build_id });
    }
    return { queued: false, reason: result.reason, build_id: result.build_id };
  });

  /**
   * GitHub App webhook: one endpoint for every repo the App is installed on,
   * signed with the app-level secret. Maintains github_installations from
   * lifecycle events and fans a push out to every source on that repo — a
   * monorepo backing several services builds them all from one delivery.
   */
  fastify.post('/webhooks/github-app', async (req, reply) => {
    const app = fastify.ctx.githubApp;
    if (!app) return reply.code(404).send({ error: 'not found' });

    const raw = req.body as Buffer;
    const signature = headerValue(req.headers['x-hub-signature-256']);
    if (!verifyGithubSignature(app.webhookSecret, raw, signature)) {
      return reply.code(401).send({ error: 'signature mismatch' });
    }

    const deliveryId = headerValue(req.headers['x-github-delivery']) ?? null;
    const event = headerValue(req.headers['x-github-event']) ?? '';
    if (event === 'ping') return { ok: true, pong: true };

    let payload: PushPayload & {
      action?: string;
      installation?: { id: number; account?: { login?: string; type?: string } };
      repository?: { full_name?: string };
    };
    try {
      payload = JSON.parse(raw.toString('utf8'));
    } catch {
      return reply.code(400).send({ error: 'invalid JSON payload' });
    }

    if (event === 'installation') {
      const inst = payload.installation;
      if (!inst?.id) return reply.code(400).send({ error: 'missing installation' });
      const installationId = String(inst.id);
      switch (payload.action) {
        case 'created':
        case 'unsuspend':
          await fastify.ctx.db
            .insertInto('github_installations')
            .values({
              installation_id: installationId,
              account_login: inst.account?.login ?? 'unknown',
              account_type: inst.account?.type ?? 'User',
              suspended_at: null,
            })
            .onConflict((oc) =>
              oc.column('installation_id').doUpdateSet({
                account_login: inst.account?.login ?? 'unknown',
                account_type: inst.account?.type ?? 'User',
                suspended_at: null,
              }),
            )
            .execute();
          break;
        case 'deleted':
          // github_sources.installation_id nulls out via the FK.
          await fastify.ctx.db
            .deleteFrom('github_installations')
            .where('installation_id', '=', installationId)
            .execute();
          break;
        case 'suspend':
          await fastify.ctx.db
            .updateTable('github_installations')
            .set({ suspended_at: new Date() })
            .where('installation_id', '=', installationId)
            .execute();
          break;
      }
      return { ok: true };
    }

    if (event !== 'push') return { queued: false, reason: 'unsupported-event' };

    const repo = payload.repository?.full_name;
    if (!repo) return reply.code(400).send({ error: 'missing repository' });

    const sources = await fastify.ctx.db
      .selectFrom('github_sources')
      .selectAll()
      .where('repo_full_name', '=', repo)
      .execute();

    const results = [];
    for (const source of sources) {
      results.push(await processPush(fastify, req, source, event, payload, 'app', deliveryId));
    }

    if (results.some((r) => r.queued)) fastify.ctx.buildWorker.kick();
    return { results };
  });
}
