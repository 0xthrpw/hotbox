import { describe, it, expect } from 'vitest';
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely';
import { JsonbWritePlugin } from '../src/jsonb-write-plugin.js';
import type { Database } from '../src/schema.js';

function makeDb(): Kysely<Database> {
  return new Kysely<Database>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
    plugins: [new JsonbWritePlugin()],
  });
}

describe('JsonbWritePlugin', () => {
  it('serializes an empty array on INSERT — the regression case', () => {
    const db = makeDb();
    const { sql, parameters } = db
      .insertInto('deployments')
      .values({
        service_id: 's',
        version: 1,
        image: 'nginx:alpine',
        env_snapshot: {},
        secret_refs: [],
        volume_refs: [],
        network_refs: [],
        container_digests: {},
      })
      .compile();

    expect(parameters).toContain('[]');
    expect(parameters).not.toContain([]);
    expect(sql).toMatch(/cast\(\$\d+ as jsonb\)/i);
  });

  it('serializes a non-empty array of objects intact on INSERT', () => {
    const db = makeDb();
    const refs = [{ name: 'eth-archive-eth', internal: true }];
    const { parameters } = db
      .insertInto('deployments')
      .values({
        service_id: 's',
        version: 1,
        image: 'erigontech/erigon:v3',
        env_snapshot: {},
        secret_refs: [],
        volume_refs: [],
        network_refs: refs,
        container_digests: {},
      })
      .compile();

    expect(parameters).toContain(JSON.stringify(refs));
    expect(parameters).not.toContain(refs);
  });

  it('serializes object-typed jsonb columns too (e.g. env_snapshot)', () => {
    const db = makeDb();
    const env = { ALCHEMY_KEY: 'abc', PORT: '3000' };
    const { parameters } = db
      .insertInto('deployments')
      .values({
        service_id: 's',
        version: 1,
        image: 'svc:latest',
        env_snapshot: env,
        secret_refs: [],
        volume_refs: [],
        network_refs: [],
        container_digests: {},
      })
      .compile();

    expect(parameters).toContain(JSON.stringify(env));
  });

  it('does not double-serialize a value the caller already stringified', () => {
    const db = makeDb();
    const raw = '[{"name":"already-a-string"}]';
    const { parameters } = db
      .insertInto('deployments')
      .values({
        service_id: 's',
        version: 1,
        image: 'svc:latest',
        env_snapshot: {},
        secret_refs: [],
        volume_refs: [],
        network_refs: raw, // JsonbDef accepts T | string
        container_digests: {},
      })
      .compile();

    expect(parameters).toContain(raw);
    expect(parameters).not.toContain(JSON.stringify(raw));
  });

  it('serializes jsonb columns on UPDATE', () => {
    const db = makeDb();
    const refs = [{ name: 'shared', internal: true }];
    const { sql, parameters } = db
      .updateTable('deployments')
      .set({ network_refs: refs, container_digests: { erigon: 'sha256:abc' } })
      .where('id', '=', 'd-1')
      .compile();

    expect(parameters).toContain(JSON.stringify(refs));
    expect(parameters).toContain(JSON.stringify({ erigon: 'sha256:abc' }));
    expect(sql).toMatch(/cast\(\$\d+ as jsonb\)/i);
  });

  it('replaces, does not append, transformed UPDATE columns (regression: "multiple assignments to same column")', () => {
    const db = makeDb();
    const { sql } = db
      .updateTable('deployments')
      .set({ container_digests: { primary: 'sha256:abc' } })
      .where('id', '=', 'd-1')
      .compile();

    // The column should appear exactly once on the LHS of SET. Anything more
    // means we appended instead of replaced and Postgres will reject with
    // 'multiple assignments to same column'.
    const matches = sql.match(/"container_digests"/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it('leaves non-jsonb columns untouched on INSERT', () => {
    const db = makeDb();
    const { parameters } = db
      .insertInto('deployments')
      .values({
        service_id: 'svc-id-12345',
        version: 42,
        image: 'nginx:alpine',
        env_snapshot: {},
        secret_refs: [],
        volume_refs: [],
        network_refs: [],
        container_digests: {},
      })
      .compile();

    expect(parameters).toContain('svc-id-12345');
    expect(parameters).toContain(42);
    expect(parameters).toContain('nginx:alpine');
  });

  it('leaves untouched tables that have no jsonb columns', () => {
    const db = makeDb();
    const { sql } = db
      .insertInto('users')
      .values({
        email: 'a@b.c',
        password_hash: 'x',
      })
      .compile();

    expect(sql).not.toMatch(/cast\(\$\d+ as jsonb\)/i);
  });
});
