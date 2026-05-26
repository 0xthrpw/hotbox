import type { FastifyInstance } from 'fastify';
import { LoginInputSchema } from '@hotbox/shared';
import { createSession, lookupSession, revokeSession, SESSION_COOKIE_NAME, verifyPassword } from '../auth.js';

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
    reply.setCookie(SESSION_COOKIE_NAME, token, {
      path: '/',
      httpOnly: true,
      secure: process.env.WEB_ORIGIN?.startsWith('https://') ?? true,
      sameSite: 'lax',
      expires: expiresAt,
    });
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
