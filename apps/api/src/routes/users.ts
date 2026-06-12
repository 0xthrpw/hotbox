import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CreateInviteInputSchema } from '@hotbox/shared';
import { createInvite } from '../invites.js';
import { requireAdmin } from './auth.js';
import { recordAudit } from '../audit.js';

export async function usersRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/users', async (req) => {
    requireAdmin(req);
    const rows = await fastify.ctx.db
      .selectFrom('users')
      .select(['id', 'email', 'role', 'disabled_at', 'created_at'])
      .orderBy('created_at', 'asc')
      .execute();
    return { users: rows };
  });

  fastify.post('/users/:id/disable', async (req, reply) => {
    requireAdmin(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    if (id === req.user.id) {
      return reply.code(400).send({ error: 'cannot disable yourself' });
    }
    await fastify.ctx.db
      .updateTable('users')
      .set({ disabled_at: new Date() })
      .where('id', '=', id)
      .execute();
    // attachSession already skips disabled users; dropping sessions too keeps
    // the sessions table from holding live-looking rows for a disabled account.
    await fastify.ctx.db.deleteFrom('sessions').where('user_id', '=', id).execute();
    await recordAudit(fastify.ctx.db, req, {
      action: 'user.disable',
      target_kind: 'user',
      target_id: id,
    });
    return reply.send({ ok: true });
  });

  fastify.post('/users/:id/enable', async (req, reply) => {
    requireAdmin(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await fastify.ctx.db
      .updateTable('users')
      .set({ disabled_at: null })
      .where('id', '=', id)
      .execute();
    await recordAudit(fastify.ctx.db, req, {
      action: 'user.enable',
      target_kind: 'user',
      target_id: id,
    });
    return reply.send({ ok: true });
  });

  fastify.get('/users/invites', async (req) => {
    requireAdmin(req);
    const rows = await fastify.ctx.db
      .selectFrom('invites')
      .leftJoin('users as creator', 'creator.id', 'invites.created_by')
      .leftJoin('users as redeemer', 'redeemer.id', 'invites.used_by')
      .select([
        'invites.id', 'invites.note', 'invites.role', 'invites.expires_at',
        'invites.used_at', 'invites.revoked_at', 'invites.created_at',
        'creator.email as created_by_email',
        'redeemer.email as used_by_email',
      ])
      .orderBy('invites.created_at', 'desc')
      .execute();
    return { invites: rows };
  });

  fastify.post('/users/invites', async (req, reply) => {
    requireAdmin(req);
    const input = CreateInviteInputSchema.parse(req.body ?? {});
    const invite = await createInvite(fastify.ctx.db, {
      createdBy: req.user.id,
      note: input.note,
      expiresInDays: input.expires_in_days,
    });
    await recordAudit(fastify.ctx.db, req, {
      action: 'invite.create',
      target_kind: 'invite',
      target_id: invite.id,
      payload: { note: input.note, expires_in_days: input.expires_in_days },
    });
    return reply.code(201).send({ id: invite.id, url: invite.url, expires_at: invite.expiresAt });
  });

  fastify.post('/users/invites/:id/revoke', async (req, reply) => {
    requireAdmin(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await fastify.ctx.db
      .updateTable('invites')
      .set({ revoked_at: new Date() })
      .where('id', '=', id)
      .where('used_at', 'is', null)
      .execute();
    await recordAudit(fastify.ctx.db, req, {
      action: 'invite.revoke',
      target_kind: 'invite',
      target_id: id,
    });
    return reply.send({ ok: true });
  });
}
