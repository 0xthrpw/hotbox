import { describe, it, expect } from 'vitest';
import { buildOptionsForRole } from '../src/template-runner.js';
import type { Deployment, ServiceWithContext } from '@hotbox/db';
import type { ContainerSpec } from '@hotbox/shared';

function svc(overrides: Partial<ServiceWithContext> = {}): ServiceWithContext {
  return {
    id: 'svc-1',
    slug: 'db',
    name: 'DB',
    host_id: 'host-1',
    project_id: 'proj-1',
    environment_id: 'env-1',
    project_slug: 'grails',
    environment_slug: 'prod',
    kind: 'app',
    desired_state: 'running',
    current_state: 'running',
    hostname: null,
    public_port: null,
    auto_subdomain: false,
    config: {},
    template: null,
    owner_id: null,
    parent_service_id: null,
    created_at: new Date(),
    updated_at: new Date(),
    archived_at: null,
    ...overrides,
  } as ServiceWithContext;
}

function dep(overrides: Partial<Deployment> = {}): Deployment {
  return {
    id: 'dep-1',
    service_id: 'svc-1',
    version: 3,
    image: 'postgres:16-alpine',
    image_digest: null,
    container_digests: {},
    env_snapshot: {},
    secret_refs: [],
    volume_refs: [],
    network_refs: [],
    command: null,
    entrypoint: null,
    healthcheck: null,
    created_by: null,
    created_at: new Date(),
    status: 'active',
    ...overrides,
  } as Deployment;
}

function nonTemplateOptions(service: ServiceWithContext, deployment: Deployment) {
  return buildOptionsForRole({
    service,
    deployment,
    role: 'primary',
    container: null,
    digest: null,
    baseLabels: {},
    version: deployment.version,
    injectedEnv: {},
  });
}

describe('buildOptionsForRole — volumes (non-template)', () => {
  it('mounts by docker volume name, not the volumes-row id', () => {
    const out = nonTemplateOptions(
      svc(),
      dep({
        volume_refs: [
          {
            volume_id: '00000000-0000-0000-0000-000000000000',
            name: 'grails-prod-db-data',
            mountpoint: '/var/lib/postgresql/data',
            ro: false,
          },
        ],
      }),
    );
    expect(out.volumes).toEqual([
      { source: 'grails-prod-db-data', target: '/var/lib/postgresql/data', ro: false },
    ]);
  });

  it('produces no mounts for an empty/absent volume_refs', () => {
    expect(nonTemplateOptions(svc(), dep()).volumes).toEqual([]);
  });
});

describe('buildOptionsForRole — command/entrypoint (non-template)', () => {
  it('passes the deployment command and entrypoint through to the container spec', () => {
    const out = nonTemplateOptions(
      svc(),
      dep({
        command: ['postgres', '-c', 'wal_level=logical'],
        entrypoint: ['docker-entrypoint.sh'],
      }),
    );
    expect(out.command).toEqual(['postgres', '-c', 'wal_level=logical']);
    expect(out.entrypoint).toEqual(['docker-entrypoint.sh']);
  });

  it('leaves command/entrypoint undefined when the deployment has none', () => {
    const out = nonTemplateOptions(svc(), dep());
    expect(out.command).toBeUndefined();
    expect(out.entrypoint).toBeUndefined();
  });

  it('does not leak the deployment command into template roles (template spec wins)', () => {
    const container: ContainerSpec = {
      role: 'erigon',
      image: 'erigontech/erigon:v3',
      env: {},
      command: ['erigon', '--chain=mainnet'],
      ports: [],
      volumes: [],
      networks: [],
      ingress: false,
    } as ContainerSpec;
    const out = buildOptionsForRole({
      service: svc({ template: 'eth-archive' }),
      deployment: dep({ command: ['should-not-appear'] }),
      role: 'erigon',
      container,
      digest: null,
      baseLabels: {},
      version: 1,
      injectedEnv: {},
    });
    expect(out.command).toEqual(['erigon', '--chain=mainnet']);
  });
});

describe('buildOptionsForRole — DNS aliases', () => {
  it('adds project-env-qualified aliases alongside the short ones on every network', () => {
    const out = nonTemplateOptions(svc(), dep());
    expect(out.networks).toContain('hotbox-public');
    expect(out.networkAliases['hotbox-public']).toEqual([
      'db',
      'db-primary',
      'grails-prod-db',
      'grails-prod-db-primary',
    ]);
  });

  it('skips qualified aliases past the 63-char DNS label limit instead of risking a rejected create', () => {
    const out = nonTemplateOptions(
      svc({
        project_slug: 'p'.repeat(30),
        environment_slug: 'e'.repeat(30),
        slug: 's'.repeat(10),
      }),
      dep(),
    );
    const aliases = out.networkAliases['hotbox-public'] ?? [];
    expect(aliases).toContain('s'.repeat(10));
    expect(aliases.some((a) => a.length > 63)).toBe(false);
    expect(aliases).toHaveLength(2);
  });
});
