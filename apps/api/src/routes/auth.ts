import type { FastifyInstance, FastifyReply } from 'fastify';
import { LoginInputSchema, SignupInputSchema } from '@hotbox/shared';
import { createSession, hashPassword, lookupSession, revokeSession, SESSION_COOKIE_NAME, verifyPassword } from '../auth.js';
import { hashInviteToken, lookupInvite } from '../invites.js';
import { recordAudit } from '../audit.js';

function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date): void {
  reply.setCookie(SESSION_COOKIE_NAME, token, {
    path: '/',
    httpOnly: true,
    secure: process.env.WEB_ORIGIN?.startsWith('https://') ?? true,
    sameSite: 'lax',
    expires: expiresAt,
  });
}

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/login', async (req, reply) => {
    const body = LoginInputSchema.parse(req.body);
    const user = await fastify.ctx.db
      .selectFrom('users')
      .selectAll()
      .where('email', '=', body.email)
      .where('disabled_at', 'is', null)
      .executeTakeFirst();
    if (!user || !(await verifyPassword(user.password_hash, body.password))) {
      return reply.code(401).send({ error: 'invalid credentials' });
    }
    const { token, expiresAt } = await createSession(fastify.ctx.db, user.id, {
      ip: req.ip,
      userAgent: req.headers['user-agent'] ?? undefined,
    });
    setSessionCookie(reply, token, expiresAt);
    return { user: { id: user.id, email: user.email, role: user.role } };
  });

  fastify.post('/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE_NAME];
    if (token) await revokeSession(fastify.ctx.db, token);
    reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    return { ok: true };
  });

  fastify.get('/me', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'unauthenticated' });
    return { user: req.user };
  });

  fastify.get('/signup/:token', async (req) => {
    const { token } = req.params as { token: string };
    const result = await lookupInvite(fastify.ctx.db, token);
    return result.status === 'valid'
      ? { status: result.status, note: result.invite.note }
      : { status: result.status };
  });

  fastify.post('/signup', async (req, reply) => {
    const body = SignupInputSchema.parse(req.body);
    const passwordHash = await hashPassword(body.password);
    const tokenHash = hashInviteToken(body.token);

    const user = await fastify.ctx.db.transaction().execute(async (trx) => {
      const invite = await trx
        .selectFrom('invites')
        .select(['id', 'role', 'expires_at', 'used_at', 'revoked_at'])
        .where('token_hash', '=', tokenHash)
        .forUpdate()
        .executeTakeFirst();
      if (!invite || invite.revoked_at || invite.used_at || invite.expires_at < new Date()) {
        return null;
      }

      const existing = await trx
        .selectFrom('users')
        .select('id')
        .where('email', '=', body.email)
        .executeTakeFirst();
      if (existing) {
        const err = new Error('email already in use') as Error & { statusCode: number };
        err.statusCode = 409;
        throw err;
      }

      const u = await trx
        .insertInto('users')
        .values({ email: body.email, password_hash: passwordHash, role: invite.role })
        .returning(['id', 'email', 'role'])
        .executeTakeFirstOrThrow();
      await trx
        .updateTable('invites')
        .set({ used_at: new Date(), used_by: u.id })
        .where('id', '=', invite.id)
        .execute();
      return { ...u, inviteId: invite.id };
    });
    if (!user) return reply.code(410).send({ error: 'invite invalid or expired' });

    await recordAudit(fastify.ctx.db, req, {
      action: 'user.signup',
      target_kind: 'user',
      target_id: user.id,
      payload: { invite_id: user.inviteId, email: user.email },
    });
    const { token, expiresAt } = await createSession(fastify.ctx.db, user.id, {
      ip: req.ip,
      userAgent: req.headers['user-agent'] ?? undefined,
    });
    setSessionCookie(reply, token, expiresAt);
    return reply.code(201).send({ user: { id: user.id, email: user.email, role: user.role } });
  });
}

export async function attachSession(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', async (req) => {
    const token = req.cookies[SESSION_COOKIE_NAME];
    if (!token) return;
    const sess = await lookupSession(fastify.ctx.db, token);
    if (!sess) return;
    const user = await fastify.ctx.db
      .selectFrom('users')
      .select(['id', 'email', 'role'])
      .where('id', '=', sess.userId)
      .where('disabled_at', 'is', null)
      .executeTakeFirst();
    if (user) req.user = user;
  });
}

export function requireAuth(req: { user?: { id: string } }): asserts req is { user: { id: string; email: string; role: string } } {
  if (!req.user) {
    const err = new Error('unauthenticated') as Error & { statusCode: number };
    err.statusCode = 401;
    throw err;
  }
}

export function requireAdmin(req: { user?: { id: string; email: string; role: string } }): asserts req is { user: { id: string; email: string; role: string } } {
  requireAuth(req);
  if (req.user.role !== 'admin') {
    const err = new Error('forbidden') as Error & { statusCode: number };
    err.statusCode = 403;
    throw err;
  }
}
