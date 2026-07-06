import { describe, it, expect } from 'vitest';
import {
  ServiceConfigSchema,
  CreateServiceInputSchema,
  CreateDeploymentInputSchema,
  VolumeMountSchema,
} from '../src/api.js';

describe('VolumeMountSchema', () => {
  it('accepts a named volume with an absolute mountpoint', () => {
    const out = VolumeMountSchema.parse({ name: 'data', mountpoint: '/var/lib/postgresql/data' });
    expect(out).toEqual({ name: 'data', mountpoint: '/var/lib/postgresql/data', ro: false });
  });

  it('rejects uppercase / underscore / leading- or trailing-dash names', () => {
    expect(() => VolumeMountSchema.parse({ name: 'Data', mountpoint: '/d' })).toThrow();
    expect(() => VolumeMountSchema.parse({ name: 'my_vol', mountpoint: '/d' })).toThrow();
    expect(() => VolumeMountSchema.parse({ name: '-bad', mountpoint: '/d' })).toThrow();
    expect(() => VolumeMountSchema.parse({ name: 'bad-', mountpoint: '/d' })).toThrow();
  });

  it('rejects relative and protocol-relative mountpoints', () => {
    expect(() => VolumeMountSchema.parse({ name: 'data', mountpoint: 'var/lib' })).toThrow();
    expect(() => VolumeMountSchema.parse({ name: 'data', mountpoint: '//host' })).toThrow();
    expect(() => VolumeMountSchema.parse({ name: 'data', mountpoint: '/' })).toThrow();
  });
});

describe('ServiceConfigSchema volumes/command', () => {
  it('defaults to no volumes and no command', () => {
    const out = ServiceConfigSchema.parse({});
    expect(out.volumes).toEqual([]);
    expect(out.command).toBeUndefined();
    expect(out.entrypoint).toBeUndefined();
  });

  it('rejects duplicate volume names and duplicate mountpoints', () => {
    expect(() =>
      ServiceConfigSchema.parse({
        volumes: [
          { name: 'data', mountpoint: '/a' },
          { name: 'data', mountpoint: '/b' },
        ],
      }),
    ).toThrow();
    expect(() =>
      ServiceConfigSchema.parse({
        volumes: [
          { name: 'a', mountpoint: '/same' },
          { name: 'b', mountpoint: '/same' },
        ],
      }),
    ).toThrow();
  });

  it('rejects an empty command array but accepts exec-form argv', () => {
    expect(() => ServiceConfigSchema.parse({ command: [] })).toThrow();
    const out = ServiceConfigSchema.parse({ command: ['postgres', '-c', 'wal_level=logical'] });
    expect(out.command).toEqual(['postgres', '-c', 'wal_level=logical']);
  });

  it('permits empty-string elements (legal exec-form args, produced by bare quotes)', () => {
    const out = ServiceConfigSchema.parse({ command: ['printf', ''] });
    expect(out.command).toEqual(['printf', '']);
  });
});

describe('CreateServiceInputSchema with volumes/command', () => {
  const base = {
    project_id: '11111111-1111-1111-1111-111111111111',
    environment_id: '22222222-2222-2222-2222-222222222222',
    name: 'DB',
    slug: 'db',
  };

  it('accepts volumes + command on an image service', () => {
    const out = CreateServiceInputSchema.parse({
      ...base,
      image: 'postgres:16-alpine',
      config: {
        volumes: [{ name: 'data', mountpoint: '/var/lib/postgresql/data' }],
        command: ['postgres', '-c', 'wal_level=logical'],
      },
    });
    expect(out.config.volumes).toHaveLength(1);
    expect(out.config.command).toEqual(['postgres', '-c', 'wal_level=logical']);
  });

  it('accepts volumes on a github service (unlike requires, which stays blocked)', () => {
    const github = {
      repo_full_name: 'owner/repo',
      branch: 'main',
    };
    const out = CreateServiceInputSchema.parse({
      ...base,
      image_source: 'github',
      github,
      config: { volumes: [{ name: 'cache', mountpoint: '/cache' }] },
    });
    expect(out.config.volumes).toHaveLength(1);

    expect(() =>
      CreateServiceInputSchema.parse({
        ...base,
        image_source: 'github',
        github,
        config: { requires: [{ kind: 'postgres', name: 'db' }] },
      }),
    ).toThrow();
  });

  it('rejects command/volumes on template services (template roles own their spec)', () => {
    expect(() =>
      CreateServiceInputSchema.parse({
        ...base,
        image: 'postgres:16-alpine',
        template: 'managed-postgres',
        config: { command: ['postgres', '-c', 'wal_level=logical'] },
      }),
    ).toThrow();
    expect(() =>
      CreateServiceInputSchema.parse({
        ...base,
        image: 'postgres:16-alpine',
        template: 'managed-postgres',
        config: { volumes: [{ name: 'data', mountpoint: '/d' }] },
      }),
    ).toThrow();
  });
});

describe('CreateDeploymentInputSchema command override', () => {
  it('accepts a one-off command/entrypoint', () => {
    const out = CreateDeploymentInputSchema.parse({
      command: ['node', 'dist/index.js'],
      entrypoint: ['/bin/sh', '-c'],
    });
    expect(out.command).toEqual(['node', 'dist/index.js']);
    expect(out.entrypoint).toEqual(['/bin/sh', '-c']);
  });

  it('still parses the empty redeploy body', () => {
    const out = CreateDeploymentInputSchema.parse({});
    expect(out.command).toBeUndefined();
  });
});
