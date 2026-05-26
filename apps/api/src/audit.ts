import type { FastifyRequest } from 'fastify';
import type { HotboxDb } from '@hotbox/db';

export interface AuditArgs {
  action: string;                          // e.g. 'service.create', 'token.revoke'
  target_kind: string;                     // 'service' | 'deployment' | 'token' | …
  target_id?: string | null;
  payload?: Record<string, unknown>;
  actor_token_id?: string | null;
}

/**
 * Best-effort audit log write. Failures are logged but never surfaced to the
 * caller — auditing must never block a user request, and a missing row in
 * audit_log is recoverable from app logs in the worst case.
 */
export async function recordAudit(
  db: HotboxDb,
  req: FastifyRequest,
  args: AuditArgs,
): Promise<void> {
  try {
    await db
      .insertInto('audit_log')
      .values({
        actor_user_id: req.user?.id ?? null,
        actor_token_id: args.actor_token_id ?? null,
        action: args.action,
        target_kind: args.target_kind,
        target_id: args.target_id ?? null,
        payload: args.payload ?? {},
        ip: req.ip ?? null,
      })
      .execute();
  } catch (err) {
    req.log.error({ err, action: args.action }, 'audit write failed');
  }
}
