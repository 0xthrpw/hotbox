import { randomBytes, createHash } from 'node:crypto';
import type { HotboxDb, TokenKind, TokenTier } from '@hotbox/db';

/**
 * Token format: `hbx_<kind>_<32-char base64url>`.
 * We store only sha256(token) on disk and the 8-char prefix for display.
 */
export interface IssuedToken {
  id: string;
  plain: string;
  prefix: string;
}

export async function issueToken(
  db: HotboxDb,
  opts: {
    kind: TokenKind;
    name: string;
    tier?: TokenTier;
    serviceId?: string;
    userId?: string;
    scopes?: string[];
    rateLimitPerMin?: number;
    expiresAt?: Date;
  },
): Promise<IssuedToken> {
  const raw = randomBytes(24).toString('base64url');
  const plain = `hbx_${opts.kind}_${raw}`;
  const hash = createHash('sha256').update(plain).digest();
  const prefix = plain.slice(0, 12);
  const row = await db
    .insertInto('tokens')
    .values({
      kind: opts.kind,
      name: opts.name,
      hash,
      prefix,
      service_id: opts.serviceId ?? null,
      user_id: opts.userId ?? null,
      scopes: opts.scopes ?? [],
      tier: opts.tier ?? 'public',
      rate_limit_per_min: opts.rateLimitPerMin ?? null,
      expires_at: opts.expiresAt ?? null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { id: row.id, plain, prefix };
}

export async function verifyToken(
  db: HotboxDb,
  plain: string,
): Promise<{ id: string; service_id: string | null; tier: TokenTier; scopes: string[] } | null> {
  const hash = createHash('sha256').update(plain).digest();
  const row = await db
    .selectFrom('tokens')
    .select(['id', 'service_id', 'tier', 'scopes', 'expires_at', 'revoked_at'])
    .where('hash', '=', hash)
    .executeTakeFirst();
  if (!row) return null;
  if (row.revoked_at) return null;
  if (row.expires_at && row.expires_at < new Date()) return null;
  return { id: row.id, service_id: row.service_id, tier: row.tier, scopes: row.scopes };
}
