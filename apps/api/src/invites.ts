import { randomBytes, createHash } from 'node:crypto';
import type { HotboxDb } from '@hotbox/db';

/**
 * Invite format: a bare 32-byte base64url token carried in the signup URL.
 * We store only sha256(token); the URL is shown once at creation and is not
 * reconstructable afterwards — the optional note is the only human-readable
 * identifier.
 */

export function inviteUrlBase(): string {
  return (process.env.WEB_ORIGIN ?? 'http://localhost:3001').replace(/\/$/, '');
}

export function hashInviteToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

export async function createInvite(
  db: HotboxDb,
  opts: { createdBy: string; note?: string; expiresInDays: number; role?: string },
): Promise<{ id: string; url: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + opts.expiresInDays * 24 * 3600 * 1000);
  const row = await db
    .insertInto('invites')
    .values({
      token_hash: hashInviteToken(token),
      note: opts.note ?? null,
      role: opts.role ?? 'member',
      created_by: opts.createdBy,
      expires_at: expiresAt,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { id: row.id, url: `${inviteUrlBase()}/signup/${token}`, expiresAt };
}

export type InviteStatus = 'invalid' | 'revoked' | 'used' | 'expired' | 'valid';

export async function lookupInvite(
  db: HotboxDb,
  token: string,
): Promise<{ status: Exclude<InviteStatus, 'valid'> } | { status: 'valid'; invite: { id: string; note: string | null; role: string } }> {
  const row = await db
    .selectFrom('invites')
    .select(['id', 'note', 'role', 'expires_at', 'used_at', 'revoked_at'])
    .where('token_hash', '=', hashInviteToken(token))
    .executeTakeFirst();
  if (!row) return { status: 'invalid' };
  if (row.revoked_at) return { status: 'revoked' };
  if (row.used_at) return { status: 'used' };
  if (row.expires_at < new Date()) return { status: 'expired' };
  return { status: 'valid', invite: { id: row.id, note: row.note, role: row.role } };
}
