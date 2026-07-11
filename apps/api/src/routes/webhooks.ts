import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { recordAudit } from '../audit.js';

/**
 * GitHub push-webhook receiver (Phase 4b). One endpoint per github_source —
 * the operator pastes the URL + per-source secret into the repo's webhook
 * settings. Registered OUTSIDE the /api session scope: callers are GitHub,
 * not browsers, and authentication is the HMAC signature, never a cookie.
 */

/** GitHub caps webhook payloads at 25 MB; push payloads are far smaller. */
const WEBHOOK_BODY_LIMIT = 5 * 1024 * 1024;

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

    const raw = req.body as Buffer;
    const signature = headerValue(req.headers['x-hub-signature-256']);
    if (!verifyGithubSignature(source.webhook_secret, raw, signature)) {
      return reply.code(401).send({ error: 'signature mismatch' });
    }

    const event = headerValue(req.headers['x-github-event']) ?? '';
    if (event === 'ping') return { ok: true, pong: true };

    let payload: { ref?: string; deleted?: boolean; head_commit?: { id?: string } | null };
    try {
      payload = JSON.parse(raw.toString('utf8'));
    } catch {
      return reply.code(400).send({ error: 'invalid JSON payload' });
    }

    const decision = evaluatePushEvent(source, event, payload);
    if (decision.action === 'ignore') {
      return { queued: false, reason: decision.reason };
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
    if (queued) return { queued: false, reason: 'already-queued', build_id: queued.id };

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
      },
    });

    fastify.ctx.buildWorker.kick();
    return reply.code(201).send({ queued: true, build_id: build.id });
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

    const event = headerValue(req.headers['x-github-event']) ?? '';
    if (event === 'ping') return { ok: true, pong: true };

    let payload: {
      action?: string;
      installation?: { id: number; account?: { login?: string; type?: string } };
      repository?: { full_name?: string };
      ref?: string;
      deleted?: boolean;
      head_commit?: { id?: string } | null;
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

    const results: Array<{ source_id: string; queued: boolean; reason?: string; build_id?: string }> = [];
    for (const source of sources) {
      const decision = evaluatePushEvent(source, event, payload);
      if (decision.action === 'ignore') {
        results.push({ source_id: source.id, queued: false, reason: decision.reason });
        continue;
      }
      const queued = await fastify.ctx.db
        .selectFrom('builds')
        .select('id')
        .where('github_source_id', '=', source.id)
        .where('status', '=', 'queued')
        .executeTakeFirst();
      if (queued) {
        results.push({ source_id: source.id, queued: false, reason: 'already-queued', build_id: queued.id });
        continue;
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
          via: 'github-app',
        },
      });
      results.push({ source_id: source.id, queued: true, build_id: build.id });
    }

    if (results.some((r) => r.queued)) fastify.ctx.buildWorker.kick();
    return { results };
  });
}
