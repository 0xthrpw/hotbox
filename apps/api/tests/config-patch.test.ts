import { describe, it, expect } from 'vitest';
import { applyConfigPatch } from '../src/routes/services.js';
import type { ServiceConfig } from '@hotbox/db';

const BASE: ServiceConfig = {
  restart_policy: 'on-failure',
  command: ['node', 'server.js'],
  resources: { mem_limit_bytes: 1024 * 1024 * 512 },
  volumes: [{ name: 'data', mountpoint: '/data' }],
};

describe('api/services applyConfigPatch', () => {
  it('leaves absent keys untouched', () => {
    const next = applyConfigPatch(BASE, { restart_policy: 'always' });
    expect(next.restart_policy).toBe('always');
    expect(next.command).toEqual(['node', 'server.js']);
    expect(next.resources).toEqual({ mem_limit_bytes: 1024 * 1024 * 512 });
  });

  it('null clears a key back to defaults', () => {
    const next = applyConfigPatch(BASE, { command: null, resources: null });
    expect('command' in next).toBe(false);
    expect('resources' in next).toBe(false);
  });

  it('never touches non-runtime keys like volumes', () => {
    const next = applyConfigPatch(BASE, {
      command: ['python', 'app.py'],
      restart_policy: 'no',
      stop_grace_period_sec: 60,
    });
    expect(next.volumes).toEqual([{ name: 'data', mountpoint: '/data' }]);
  });

  it('does not mutate the input config', () => {
    applyConfigPatch(BASE, { command: null });
    expect(BASE.command).toEqual(['node', 'server.js']);
  });
});
