import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  CreateVariableInputSchema,
  UpdateVariableInputSchema,
  type CreateVariableInput,
  type UpdateVariableInput,
} from '@hotbox/shared';
import { seal, open, type KeyRing } from '@hotbox/crypto';
import type { HotboxDb, Variable, VariableScope, NewVariable } from '@hotbox/db';
import { requireAuth } from './auth.js';
import { recordAudit } from '../audit.js';
import { resolveVariablesWithOrigin, affectedServiceIds } from '../lib/resolve-variables.js';

// Strip the encrypted fields off a row before returning it to the client.
// Secret values are intentionally null in the response — the only place a
// decrypted value flows is into a container's env at deploy time, never out
// through this API.
function toResponse(row: Variable) {
  return {
    id: row.id,
    scope: row.scope,
    key: row.key,
    value: row.is_secret ? null : row.value,
    is_secret: row.is_secret,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function buildInsert(opts: {
  scope: VariableScope;
  scopeId: string;
  input: CreateVariableInput;
  keyring: KeyRing;
}): NewVariable {
  const base = {
    scope: opts.scope,
    key: opts.input.key,
    is_secret: opts.input.is_secret,
    project_id: opts.scope === 'project' ? opts.scopeId : null,
    environment_id: opts.scope === 'environment' ? opts.scopeId : null,
    service_id: opts.scope === 'service' ? opts.scopeId : null,
  };
  if (opts.input.is_secret) {
    const sealed = seal(opts.keyring, opts.input.value);
    return {
      ...base,
      value: null,
      ciphertext: sealed.ciphertext,
      nonce: sealed.nonce,
      key_version: sealed.keyVersion,
    };
  }
  return {
    ...base,
    value: opts.input.value,
    ciphertext: null,
    nonce: null,
    key_version: null,
  };
}

function buildUpdate(opts: {
  current: Variable;
  input: UpdateVariableInput;
  keyring: KeyRing;
}): Partial<NewVariable> {
  const willBeSecret = opts.input.is_secret ?? opts.current.is_secret;
  if (opts.input.value === undefined) {
    // Only flipping is_secret — we'd need the plaintext to re-shape, but the
    // mutation API doesn't carry it. Disallow this case; require sending a
    // value alongside is_secret.
    if (opts.input.is_secret !== undefined && opts.input.is_secret !== opts.current.is_secret) {
      throw Object.assign(new Error('flipping is_secret requires sending value'), { statusCode: 400 });
    }
    return {};
  }
  if (willBeSecret) {
    const sealed = seal(opts.keyring, opts.input.value);
    return {
      is_secret: true,
      value: null,
      ciphertext: sealed.ciphertext,
      nonce: sealed.nonce,
      key_version: sealed.keyVersion,
    };
  }
  return {
    is_secret: false,
    value: opts.input.value,
    ciphertext: null,
    nonce: null,
    key_version: null,
  };
}

async function loadList(
  db: HotboxDb,
  scope: VariableScope,
  scopeId: string,
): Promise<Variable[]> {
  const column = scope === 'project' ? 'project_id' : scope === 'environment' ? 'environment_id' : 'service_id';
  return db
    .selectFrom('variables')
    .selectAll()
    .where(column, '=', scopeId)
    .orderBy('key', 'asc')
    .execute();
}

async function loadOwner(
  db: HotboxDb,
  scope: VariableScope,
  scopeId: string,
): Promise<boolean> {
  if (scope === 'project') {
    const row = await db.selectFrom('projects').select('id').where('id', '=', scopeId).executeTakeFirst();
    return !!row;
  }
  if (scope === 'environment') {
    const row = await db.selectFrom('environments').select('id').where('id', '=', scopeId).executeTakeFirst();
    return !!row;
  }
  const row = await db.selectFrom('services').select('id').where('id', '=', scopeId).executeTakeFirst();
  return !!row;
}

export async function variablesRoutes(fastify: FastifyInstance): Promise<void> {
  registerScope(fastify, 'project', '/projects/:id/variables');
  registerScope(fastify, 'environment', '/environments/:id/variables');
  registerScope(fastify, 'service', '/services/:id/variables');

  // Effective view — only meaningful at the service scope (it's the merged
  // map a deployment would actually get). Origin badge per key lets the UI
  // show which scope is winning.
  fastify.get('/services/:id/variables/effective', async (req, reply) => {
    requireAuth(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const svc = await fastify.ctx.db
      .selectFrom('services').select('id').where('id', '=', id).executeTakeFirst();
    if (!svc) return reply.code(404).send({ error: 'not found' });
    const resolved = await resolveVariablesWithOrigin(fastify.ctx.db, fastify.ctx.keyring, id);
    // Mask secret values — the merged map is the same shape that ends up
    // inside the container, but exposing it through this endpoint would
    // sidestep the per-row secret hiding in the regular list routes.
    const variables = Object.entries(resolved).map(([key, v]) => ({
      key,
      value: v.is_secret ? null : v.value,
      origin: v.origin,
      is_secret: v.is_secret,
    }));
    variables.sort((a, b) => a.key.localeCompare(b.key));
    return { variables };
  });
}

function registerScope(
  fastify: FastifyInstance,
  scope: VariableScope,
  pathPrefix: string,
): void {
  fastify.get(pathPrefix, async (req, reply) => {
    requireAuth(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    if (!(await loadOwner(fastify.ctx.db, scope, id))) {
      return reply.code(404).send({ error: 'scope not found' });
    }
    const rows = await loadList(fastify.ctx.db, scope, id);
    return { variables: rows.map(toResponse) };
  });

  fastify.post(pathPrefix, async (req, reply) => {
    requireAuth(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const input = CreateVariableInputSchema.parse(req.body);
    if (!(await loadOwner(fastify.ctx.db, scope, id))) {
      return reply.code(404).send({ error: 'scope not found' });
    }
    const existing = await fastify.ctx.db
      .selectFrom('variables')
      .select('id')
      .where(scopeColumn(scope), '=', id)
      .where('key', '=', input.key)
      .executeTakeFirst();
    if (existing) return reply.code(409).send({ error: 'key already exists in this scope' });

    const inserted = await fastify.ctx.db
      .insertInto('variables')
      .values(buildInsert({ scope, scopeId: id, input, keyring: fastify.ctx.keyring }))
      .returningAll()
      .executeTakeFirstOrThrow();

    const affected = await affectedServiceIds(fastify.ctx.db, scope, id);
    await recordAudit(fastify.ctx.db, req, {
      action: 'variable.create',
      target_kind: 'variable',
      target_id: inserted.id,
      payload: { scope, scope_id: id, key: inserted.key, is_secret: inserted.is_secret },
    });
    return { variable: toResponse(inserted), affected_service_ids: affected };
  });

  fastify.patch(`${pathPrefix}/:varId`, async (req, reply) => {
    requireAuth(req);
    const { id, varId } = z
      .object({ id: z.string().uuid(), varId: z.string().uuid() })
      .parse(req.params);
    const input = UpdateVariableInputSchema.parse(req.body);
    const current = await fastify.ctx.db
      .selectFrom('variables')
      .selectAll()
      .where('id', '=', varId)
      .where(scopeColumn(scope), '=', id)
      .executeTakeFirst();
    if (!current) return reply.code(404).send({ error: 'not found' });

    const patch = buildUpdate({ current, input, keyring: fastify.ctx.keyring });
    if (Object.keys(patch).length === 0) {
      // No-op update — return current as-is so the UI flow stays simple.
      return { variable: toResponse(current), affected_service_ids: [] };
    }

    const updated = await fastify.ctx.db
      .updateTable('variables')
      .set(patch)
      .where('id', '=', varId)
      .returningAll()
      .executeTakeFirstOrThrow();

    const affected = await affectedServiceIds(fastify.ctx.db, scope, id);
    await recordAudit(fastify.ctx.db, req, {
      action: 'variable.update',
      target_kind: 'variable',
      target_id: varId,
      payload: { scope, scope_id: id, key: updated.key, is_secret: updated.is_secret },
    });
    return { variable: toResponse(updated), affected_service_ids: affected };
  });

  fastify.delete(`${pathPrefix}/:varId`, async (req, reply) => {
    requireAuth(req);
    const { id, varId } = z
      .object({ id: z.string().uuid(), varId: z.string().uuid() })
      .parse(req.params);
    const existing = await fastify.ctx.db
      .selectFrom('variables')
      .selectAll()
      .where('id', '=', varId)
      .where(scopeColumn(scope), '=', id)
      .executeTakeFirst();
    if (!existing) return reply.code(404).send({ error: 'not found' });
    await fastify.ctx.db.deleteFrom('variables').where('id', '=', varId).execute();
    const affected = await affectedServiceIds(fastify.ctx.db, scope, id);
    await recordAudit(fastify.ctx.db, req, {
      action: 'variable.delete',
      target_kind: 'variable',
      target_id: varId,
      payload: { scope, scope_id: id, key: existing.key, is_secret: existing.is_secret },
    });
    return { ok: true, affected_service_ids: affected };
  });
}

function scopeColumn(scope: VariableScope): 'project_id' | 'environment_id' | 'service_id' {
  if (scope === 'project') return 'project_id';
  if (scope === 'environment') return 'environment_id';
  return 'service_id';
}

/** Re-export so callers can decrypt variable rows the same way the route does. */
export { open };
