import { describe, it, expect } from 'vitest';
import {
  loadTemplate,
  listTemplates,
  interpolateTemplate,
  clearTemplateCache,
} from '../src/template-loader.js';

describe('template-loader', () => {
  it('lists the templates shipped with the package', async () => {
    clearTemplateCache();
    const names = await listTemplates();
    expect(names).toContain('eth-archive');
    expect(names).toContain('managed-postgres');
    expect(names).toContain('managed-redis');
  });

  it('parses eth-archive and exposes the expected structure', async () => {
    const t = await loadTemplate('eth-archive');
    expect(t.id).toBe('eth-archive');
    const erigon = t.containers.find((c) => c.role === 'erigon');
    const lighthouse = t.containers.find((c) => c.role === 'lighthouse');
    expect(erigon).toBeDefined();
    expect(lighthouse).toBeDefined();
    expect(erigon!.ingress).toBe(true);
    expect(erigon!.ingress_via).toBe('hotbox-rpc-proxy@file');
    expect(lighthouse!.ingress).toBe(false);
    expect(t.bootstrap[0]?.kind).toBe('random_hex');
    expect(t.bootstrap[0]?.size).toBe(32);
  });

  it('interpolates {svc} in every string position', async () => {
    const t = await loadTemplate('eth-archive');
    const out = interpolateTemplate(t, 'my-node');
    const erigon = out.containers.find((c) => c.role === 'erigon')!;
    expect(erigon.networks).toContain('my-node-eth');
    expect(erigon.networks).toContain('hotbox-public');

    const lighthouse = out.containers.find((c) => c.role === 'lighthouse')!;
    expect(lighthouse.command?.some((c) => c.includes('my-node-erigon'))).toBe(true);

    expect(out.volumes.map((v) => v.name)).toContain('my-node-erigon-data');
    expect(out.bootstrap[0]?.volume).toBe('my-node-jwt');
  });

  it('interpolation is non-mutating', async () => {
    const t = await loadTemplate('eth-archive');
    const before = JSON.stringify(t);
    interpolateTemplate(t, 'whatever');
    expect(JSON.stringify(t)).toBe(before);
  });
});
