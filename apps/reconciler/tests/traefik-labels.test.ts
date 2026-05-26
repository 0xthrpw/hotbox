import { describe, it, expect } from 'vitest';
import { traefikLabelsFor } from '../src/traefik-labels.js';
import type { Service } from '@hotbox/db';
import type { ContainerSpec } from '@hotbox/shared';

function svc(overrides: Partial<Service> = {}): Service {
  return {
    id: 'svc-1',
    slug: 'my-app',
    name: 'My App',
    host_id: 'host-1',
    kind: 'app',
    desired_state: 'running',
    current_state: 'running',
    hostname: 'app.example',
    public_port: 8080,
    config: {},
    template: null,
    owner_id: null,
    parent_service_id: null,
    created_at: new Date(),
    updated_at: new Date(),
    archived_at: null,
    ...overrides,
  } as Service;
}

function tmpl(overrides: Partial<ContainerSpec> = {}): ContainerSpec {
  return {
    role: 'erigon',
    image: 'erigontech/erigon:v3',
    env: {},
    ports: [],
    volumes: [],
    networks: [],
    ingress: false,
    ...overrides,
  } as ContainerSpec;
}

describe('traefikLabelsFor', () => {
  it('returns no labels when the service has no hostname', () => {
    const out = traefikLabelsFor({ service: svc({ hostname: null }), container: null });
    expect(out).toEqual({});
  });

  it('returns no labels when the container is not the ingress target', () => {
    const out = traefikLabelsFor({ service: svc(), container: tmpl({ ingress: false }) });
    expect(out).toEqual({});
  });

  it('builds a direct route when ingress_via is unset (legacy path)', () => {
    const out = traefikLabelsFor({ service: svc(), container: null });
    expect(out['traefik.enable']).toBe('true');
    expect(out['traefik.http.routers.my-app.rule']).toBe('Host(`app.example`)');
    expect(out['traefik.http.services.my-app.loadbalancer.server.port']).toBe('8080');
    expect(out['traefik.http.routers.my-app.middlewares']).toBeUndefined();
  });

  it('routes through file-provider service and attaches forwardauth when ingress_via is set', () => {
    const out = traefikLabelsFor({
      service: svc(),
      container: tmpl({ ingress: true, ingress_via: 'hotbox-rpc-proxy@file' }),
    });
    expect(out['traefik.http.routers.my-app.service']).toBe('hotbox-rpc-proxy@file');
    expect(out['traefik.http.routers.my-app.middlewares']).toBe('hotbox-auth@file');
    expect(out['traefik.http.services.my-app.loadbalancer.server.port']).toBeUndefined();
  });
});
