import { describe, it, expect } from 'vitest';
import { traefikLabelsFor, autoSubdomainFor } from '../src/traefik-labels.js';
import type { ServiceWithContext } from '@hotbox/db';
import type { ContainerSpec } from '@hotbox/shared';

const BASE = 'on.hotbox.wtf';

function svc(overrides: Partial<ServiceWithContext> = {}): ServiceWithContext {
  return {
    id: 'svc-1',
    slug: 'my-app',
    name: 'My App',
    host_id: 'host-1',
    project_id: 'proj-1',
    environment_id: 'env-1',
    project_slug: 'widget-sales',
    environment_slug: 'production',
    kind: 'app',
    desired_state: 'running',
    current_state: 'running',
    hostname: 'app.example',
    public_port: 8080,
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

describe('autoSubdomainFor', () => {
  it('returns null when the base is unset', () => {
    expect(autoSubdomainFor(svc({ auto_subdomain: true }), null)).toBeNull();
  });

  it('returns null when the service has not opted in', () => {
    expect(autoSubdomainFor(svc({ auto_subdomain: false }), BASE)).toBeNull();
  });

  it('formats as <slug>-<env>-<project>.<base>', () => {
    expect(autoSubdomainFor(svc({ auto_subdomain: true }), BASE)).toBe(
      'my-app-production-widget-sales.on.hotbox.wtf',
    );
  });
});

describe('traefikLabelsFor', () => {
  it('returns no labels when the role is not the ingress target', () => {
    const out = traefikLabelsFor({
      service: svc(),
      container: tmpl({ ingress: false }),
      autoSubdomainBase: BASE,
    });
    expect(out).toEqual({});
  });

  it('returns no labels when the service has no public_port', () => {
    const out = traefikLabelsFor({
      service: svc({ public_port: null }),
      container: null,
      autoSubdomainBase: BASE,
    });
    expect(out).toEqual({});
  });

  it('returns no labels when the service has neither a custom hostname nor an auto subdomain', () => {
    const out = traefikLabelsFor({
      service: svc({ hostname: null, auto_subdomain: false }),
      container: null,
      autoSubdomainBase: BASE,
    });
    expect(out).toEqual({});
  });

  it('emits a custom-hostname router with le-http when only hostname is set', () => {
    const out = traefikLabelsFor({
      service: svc(),
      container: null,
      autoSubdomainBase: BASE,
    });
    expect(out['traefik.enable']).toBe('true');
    expect(out['traefik.http.routers.widget-sales-production-my-app-custom.rule']).toBe(
      'Host(`app.example`)',
    );
    expect(out['traefik.http.routers.widget-sales-production-my-app-custom.tls.certresolver']).toBe(
      'le-http',
    );
    expect(out['traefik.http.routers.widget-sales-production-my-app-custom.service']).toBe(
      'widget-sales-production-my-app',
    );
    expect(out['traefik.http.services.widget-sales-production-my-app.loadbalancer.server.port']).toBe(
      '8080',
    );
    // No auto router was emitted
    expect(Object.keys(out).some((k) => k.endsWith('-auto.rule'))).toBe(false);
  });

  it('uses le-dns for a custom hostname that is a single label under the base (reuses the wildcard cert)', () => {
    const out = traefikLabelsFor({
      service: svc({ hostname: 'testy.on.hotbox.wtf' }),
      container: null,
      autoSubdomainBase: BASE,
    });
    expect(out['traefik.http.routers.widget-sales-production-my-app-custom.rule']).toBe(
      'Host(`testy.on.hotbox.wtf`)',
    );
    expect(out['traefik.http.routers.widget-sales-production-my-app-custom.tls.certresolver']).toBe(
      'le-dns',
    );
  });

  it('keeps le-http for a multi-label host under the base (single-level wildcard cannot cover it)', () => {
    const out = traefikLabelsFor({
      service: svc({ hostname: 'foo.testy.on.hotbox.wtf' }),
      container: null,
      autoSubdomainBase: BASE,
    });
    expect(out['traefik.http.routers.widget-sales-production-my-app-custom.tls.certresolver']).toBe(
      'le-http',
    );
  });

  it('keeps le-http for the base domain itself (wildcard does not cover the apex)', () => {
    const out = traefikLabelsFor({
      service: svc({ hostname: BASE }),
      container: null,
      autoSubdomainBase: BASE,
    });
    expect(out['traefik.http.routers.widget-sales-production-my-app-custom.tls.certresolver']).toBe(
      'le-http',
    );
  });

  it('keeps le-http for a host under the base when no base is configured', () => {
    const out = traefikLabelsFor({
      service: svc({ hostname: 'testy.on.hotbox.wtf' }),
      container: null,
      autoSubdomainBase: null,
    });
    expect(out['traefik.http.routers.widget-sales-production-my-app-custom.tls.certresolver']).toBe(
      'le-http',
    );
  });

  it('emits an auto-subdomain router with le-dns when only auto_subdomain is set', () => {
    const out = traefikLabelsFor({
      service: svc({ hostname: null, auto_subdomain: true }),
      container: null,
      autoSubdomainBase: BASE,
    });
    expect(out['traefik.http.routers.widget-sales-production-my-app-auto.rule']).toBe(
      'Host(`my-app-production-widget-sales.on.hotbox.wtf`)',
    );
    expect(out['traefik.http.routers.widget-sales-production-my-app-auto.tls.certresolver']).toBe(
      'le-dns',
    );
    // No custom router was emitted
    expect(Object.keys(out).some((k) => k.endsWith('-custom.rule'))).toBe(false);
  });

  it('emits both routers, sharing a single loadbalancer service, when both are set', () => {
    const out = traefikLabelsFor({
      service: svc({ auto_subdomain: true }),
      container: null,
      autoSubdomainBase: BASE,
    });
    expect(out['traefik.http.routers.widget-sales-production-my-app-custom.tls.certresolver']).toBe(
      'le-http',
    );
    expect(out['traefik.http.routers.widget-sales-production-my-app-auto.tls.certresolver']).toBe(
      'le-dns',
    );
    expect(out['traefik.http.routers.widget-sales-production-my-app-custom.service']).toBe(
      'widget-sales-production-my-app',
    );
    expect(out['traefik.http.routers.widget-sales-production-my-app-auto.service']).toBe(
      'widget-sales-production-my-app',
    );
    // Loadbalancer is defined once and shared.
    const lbKeys = Object.keys(out).filter((k) => k.includes('.loadbalancer.server.port'));
    expect(lbKeys.length).toBe(1);
  });

  it('silently falls back to custom-only when auto_subdomain is true but the base is unset', () => {
    const out = traefikLabelsFor({
      service: svc({ auto_subdomain: true }),
      container: null,
      autoSubdomainBase: null,
    });
    // Custom hostname still works
    expect(out['traefik.http.routers.widget-sales-production-my-app-custom.rule']).toBe(
      'Host(`app.example`)',
    );
    // No auto router — operator hasn't configured DNS yet
    expect(Object.keys(out).some((k) => k.endsWith('-auto.rule'))).toBe(false);
  });

  it('returns {} when auto_subdomain is true but neither base nor hostname is set', () => {
    const out = traefikLabelsFor({
      service: svc({ auto_subdomain: true, hostname: null }),
      container: null,
      autoSubdomainBase: null,
    });
    expect(out).toEqual({});
  });

  it('routes through file-provider service and attaches forwardauth when ingress_via is set', () => {
    const out = traefikLabelsFor({
      service: svc(),
      container: tmpl({ ingress: true, ingress_via: 'hotbox-rpc-proxy@file' }),
      autoSubdomainBase: BASE,
    });
    expect(out['traefik.http.routers.widget-sales-production-my-app-custom.service']).toBe(
      'hotbox-rpc-proxy@file',
    );
    expect(out['traefik.http.routers.widget-sales-production-my-app-custom.middlewares']).toBe(
      'hotbox-auth@file',
    );
    // No own loadbalancer when delegating to a file-provider service
    expect(Object.keys(out).some((k) => k.includes('.loadbalancer.server.port'))).toBe(false);
  });

  it('namespaces the router id so two services with the same slug in different envs do not collide', () => {
    const prod = traefikLabelsFor({
      service: svc(),
      container: null,
      autoSubdomainBase: BASE,
    });
    const dev = traefikLabelsFor({
      service: svc({ environment_slug: 'dev', hostname: 'app-dev.example' }),
      container: null,
      autoSubdomainBase: BASE,
    });
    expect(Object.keys(prod).some((k) => k.includes('widget-sales-production-my-app'))).toBe(true);
    expect(Object.keys(dev).some((k) => k.includes('widget-sales-dev-my-app'))).toBe(true);
    const prodKeys = new Set(Object.keys(prod));
    const devKeys = new Set(Object.keys(dev));
    for (const k of prodKeys) if (k.startsWith('traefik.http.')) expect(devKeys.has(k)).toBe(false);
  });
});
