import { open, type KeyRing } from '@hotbox/crypto';
import type { HotboxDb, Variable, VariableScope } from '@hotbox/db';

export interface ResolvedVariable {
  value: string;
  origin: VariableScope;
  is_secret: boolean;
}

/**
 * Returns the merged env-var map a service should see at deploy time:
 * project vars first, then env vars, then service vars (service wins on
 * conflicts). Secrets are decrypted through the keyring; callers should
 * treat the result as sensitive (it's the same map that ends up in
 * deployment.env_snapshot and inside the running container).
 */
export async function resolveVariables(
  db: HotboxDb,
  keyring: KeyRing,
  serviceId: string,
): Promise<Record<string, string>> {
  const withOrigin = await resolveVariablesWithOrigin(db, keyring, serviceId);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(withOrigin)) out[k] = v.value;
  return out;
}

/**
 * Same as resolveVariables but each value carries the scope it came from
 * and whether the source row was marked secret. Used by the
 * GET /services/:id/variables/effective endpoint so the UI can render
 * origin badges and mask values whose source row is a secret.
 *
 * Three small selects beats one over-joined query — each path uses a
 * partial unique index, so the lookups are cheap. The merge runs in
 * application code where the precedence rule is obvious.
 */
export async function resolveVariablesWithOrigin(
  db: HotboxDb,
  keyring: KeyRing,
  serviceId: string,
): Promise<Record<string, ResolvedVariable>> {
  const svc = await db
    .selectFrom('services')
    .select(['project_id', 'environment_id'])
    .where('id', '=', serviceId)
    .executeTakeFirst();
  if (!svc) return {};

  const [projectVars, envVars, serviceVars] = await Promise.all([
    db.selectFrom('variables').selectAll().where('project_id', '=', svc.project_id).execute(),
    db.selectFrom('variables').selectAll().where('environment_id', '=', svc.environment_id).execute(),
    db.selectFrom('variables').selectAll().where('service_id', '=', serviceId).execute(),
  ]);

  return mergeVariableRows({ projectVars, envVars, serviceVars }, keyring);
}

/**
 * Pure merge of three pre-loaded variable lists into the resolved map.
 * Extracted so the precedence + decryption logic is testable without a
 * real database. Order is project → env → service so later writes win
 * (object spread semantics).
 */
export function mergeVariableRows(
  groups: { projectVars: Variable[]; envVars: Variable[]; serviceVars: Variable[] },
  keyring: KeyRing,
): Record<string, ResolvedVariable> {
  const out: Record<string, ResolvedVariable> = {};
  for (const row of groups.projectVars) applyRow(out, row, keyring);
  for (const row of groups.envVars) applyRow(out, row, keyring);
  for (const row of groups.serviceVars) applyRow(out, row, keyring);
  return out;
}

function applyRow(
  out: Record<string, ResolvedVariable>,
  row: Variable,
  keyring: KeyRing,
): void {
  let plain: string;
  if (row.is_secret) {
    if (!row.ciphertext || !row.nonce || row.key_version === null) return; // shape invariant
    plain = open(keyring, {
      ciphertext: row.ciphertext,
      nonce: row.nonce,
      keyVersion: row.key_version,
    });
  } else {
    if (row.value === null) return; // shape invariant
    plain = row.value;
  }
  out[row.key] = { value: plain, origin: row.scope, is_secret: row.is_secret };
}

/**
 * For a variable mutation at scope X, return the list of service ids
 * whose effective env would change. Used by the API to tell the UI
 * "Redeploy N services to apply".
 *
 *   project scope  → all non-archived services in the project
 *   env scope      → all non-archived services in that environment
 *   service scope  → just that one service
 *
 * Returns ids only — the UI does the actual redeploy on user confirm.
 */
export async function affectedServiceIds(
  db: HotboxDb,
  scope: VariableScope,
  scopeId: string,
): Promise<string[]> {
  let q = db
    .selectFrom('services')
    .select('id')
    .where('archived_at', 'is', null);
  if (scope === 'project') q = q.where('project_id', '=', scopeId);
  else if (scope === 'environment') q = q.where('environment_id', '=', scopeId);
  else q = q.where('id', '=', scopeId);
  const rows = await q.execute();
  return rows.map((r) => r.id);
}
