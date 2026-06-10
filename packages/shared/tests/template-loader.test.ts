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
    expect(erigon).toBeDefined();
    expect(erigon!.ingress).toBe(true);
    expect(erigon!.ingress_via).toBe('hotbox-rpc-proxy@file');
    // Erigon runs its built-in Caplin consensus client — there is no external
    // lighthouse role, and therefore no JWT bootstrap.
    expect(t.containers).toHaveLength(1);
    expect(t.containers.find((c) => c.role === 'lighthouse')).toBeUndefined();
    expect(t.bootstrap).toHaveLength(0);
  });

  it('interpolates {svc} in every string position', async () => {
    const t = await loadTemplate('eth-archive');
    const out = interpolateTemplate(t, 'my-node');
    const erigon = out.containers.find((c) => c.role === 'erigon')!;
    expect(erigon.networks).toContain('hotbox-public');
    expect(erigon.volumes.map((v) => v.name)).toContain('my-node-erigon-data');

    expect(out.volumes.map((v) => v.name)).toContain('my-node-erigon-data');

    // {svc} is interpolated inside panel source URLs
    const syncPanel = out.panels.find((p) => p.id === 'sync')!;
    const promSrc = syncPanel.sources.find((s) => s.type === 'prometheus');
    expect(promSrc).toBeDefined();
    expect(promSrc!.url).toContain('my-node-erigon');
  });

  it('interpolation is non-mutating', async () => {
    const t = await loadTemplate('eth-archive');
    const before = JSON.stringify(t);
    interpolateTemplate(t, 'whatever');
    expect(JSON.stringify(t)).toBe(before);
  });
});
