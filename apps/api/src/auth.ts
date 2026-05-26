import argon2 from 'argon2';
import { randomBytes, createHash } from 'node:crypto';
import type { HotboxDb } from '@hotbox/db';

const SESSION_TTL_DAYS = 30;
const SESSION_COOKIE = 'hotbox_session';

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

export interface SessionRecord {
  id: string;
  user_id: string;
  expires_at: Date;
}

export async function createSession(
  db: HotboxDb,
  userId: string,
  meta: { ip?: string; userAgent?: string } = {},
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token).digest();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 3600 * 1000);
  await db
    .insertInto('sessions')
    .values({
      user_id: userId,
      token_hash: hash,
      expires_at: expiresAt,
      created_ip: meta.ip ?? null,
      user_agent: meta.userAgent ?? null,
    })
    .execute();
  return { token, expiresAt };
}

export async function lookupSession(db: HotboxDb, token: string): Promise<{ userId: string } | null> {
  const hash = createHash('sha256').update(token).digest();
  const row = await db
    .selectFrom('sessions')
    .select(['user_id', 'expires_at'])
    .where('token_hash', '=', hash)
    .where('expires_at', '>', new Date())
    .executeTakeFirst();
  if (!row) return null;
  return { userId: row.user_id };
}

export async function revokeSession(db: HotboxDb, token: string): Promise<void> {
  const hash = createHash('sha256').update(token).digest();
  await db.deleteFrom('sessions').where('token_hash', '=', hash).execute();
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE;
