import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { KeyRing, seal } from '@hotbox/crypto';
import type { Variable } from '@hotbox/db';
import { mergeVariableRows } from '../src/lib/resolve-variables.js';

function ring(): KeyRing {
  const r = new KeyRing();
  r.add(1, randomBytes(32));
  return r;
}

function plainVar(opts: { scope: Variable['scope']; key: string; value: string }): Variable {
  return {
    id: `${opts.scope}-${opts.key}`,
    project_id: opts.scope === 'project' ? 'p1' : null,
    environment_id: opts.scope === 'environment' ? 'e1' : null,
    service_id: opts.scope === 'service' ? 's1' : null,
    scope: opts.scope,
    key: opts.key,
    value: opts.value,
    ciphertext: null,
    nonce: null,
    key_version: null,
    is_secret: false,
    created_at: new Date(),
    updated_at: new Date(),
  } as Variable;
}

function secretVar(opts: { scope: Variable['scope']; key: string; plaintext: string; keyring: KeyRing }): Variable {
  const sealed = seal(opts.keyring, opts.plaintext);
  return {
    id: `${opts.scope}-${opts.key}-secret`,
    project_id: opts.scope === 'project' ? 'p1' : null,
    environment_id: opts.scope === 'environment' ? 'e1' : null,
    service_id: opts.scope === 'service' ? 's1' : null,
    scope: opts.scope,
    key: opts.key,
    value: null,
    ciphertext: sealed.ciphertext,
    nonce: sealed.nonce,
    key_version: sealed.keyVersion,
    is_secret: true,
    created_at: new Date(),
    updated_at: new Date(),
  } as Variable;
}

describe('mergeVariableRows precedence', () => {
  it('returns project-only values when there are no overrides', () => {
    const r = ring();
    const merged = mergeVariableRows({
      projectVars: [plainVar({ scope: 'project', key: 'STRIPE_KEY', value: 'pk_test' })],
      envVars: [],
      serviceVars: [],
    }, r);
    expect(merged.STRIPE_KEY).toEqual({ value: 'pk_test', origin: 'project', is_secret: false });
  });

  it('env overrides project for the same key', () => {
    const r = ring();
    const merged = mergeVariableRows({
      projectVars: [plainVar({ scope: 'project', key: 'DB_HOST', value: 'db.shared' })],
      envVars: [plainVar({ scope: 'environment', key: 'DB_HOST', value: 'db.dev' })],
      serviceVars: [],
    }, r);
    expect(merged.DB_HOST).toEqual({ value: 'db.dev', origin: 'environment', is_secret: false });
  });

  it('service overrides env and project for the same key', () => {
    const r = ring();
    const merged = mergeVariableRows({
      projectVars: [plainVar({ scope: 'project', key: 'LOG_LEVEL', value: 'info' })],
      envVars: [plainVar({ scope: 'environment', key: 'LOG_LEVEL', value: 'debug' })],
      serviceVars: [plainVar({ scope: 'service', key: 'LOG_LEVEL', value: 'trace' })],
    }, r);
    expect(merged.LOG_LEVEL).toEqual({ value: 'trace', origin: 'service', is_secret: false });
  });

  it('unioned keys land in the merged map', () => {
    const r = ring();
    const merged = mergeVariableRows({
      projectVars: [plainVar({ scope: 'project', key: 'ONE', value: '1' })],
      envVars: [plainVar({ scope: 'environment', key: 'TWO', value: '2' })],
      serviceVars: [plainVar({ scope: 'service', key: 'THREE', value: '3' })],
    }, r);
    expect(Object.keys(merged).sort()).toEqual(['ONE', 'THREE', 'TWO']);
    expect(merged.ONE.origin).toBe('project');
    expect(merged.TWO.origin).toBe('environment');
    expect(merged.THREE.origin).toBe('service');
  });

  it('decrypts secrets through the keyring', () => {
    const r = ring();
    const merged = mergeVariableRows({
      projectVars: [],
      envVars: [secretVar({ scope: 'environment', key: 'API_KEY', plaintext: 'top-secret', keyring: r })],
      serviceVars: [],
    }, r);
    expect(merged.API_KEY.value).toBe('top-secret');
    expect(merged.API_KEY.is_secret).toBe(true);
    expect(merged.API_KEY.origin).toBe('environment');
  });

  it('a service-scope secret beats a plain env-scope value of the same key', () => {
    const r = ring();
    const merged = mergeVariableRows({
      projectVars: [],
      envVars: [plainVar({ scope: 'environment', key: 'API_KEY', value: 'dev-default' })],
      serviceVars: [secretVar({ scope: 'service', key: 'API_KEY', plaintext: 'real-key', keyring: r })],
    }, r);
    expect(merged.API_KEY.value).toBe('real-key');
    expect(merged.API_KEY.is_secret).toBe(true);
    expect(merged.API_KEY.origin).toBe('service');
  });

  it('returns an empty map when all three scopes are empty', () => {
    expect(mergeVariableRows({ projectVars: [], envVars: [], serviceVars: [] }, ring())).toEqual({});
  });
});
