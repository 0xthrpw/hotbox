import { describe, it, expect } from 'vitest';
import { dockerVolumeName, qualifiedServiceName } from '../src/naming.js';

describe('qualifiedServiceName', () => {
  it('joins project, env, and service slugs', () => {
    expect(
      qualifiedServiceName({ projectSlug: 'efp', environmentSlug: 'prod', serviceSlug: 'efp-db' }),
    ).toBe('efp-prod-efp-db');
  });
});

describe('dockerVolumeName', () => {
  it('namespaces by project + env + service so the same short name never collides', () => {
    const efp = dockerVolumeName({
      projectSlug: 'efp',
      environmentSlug: 'prod',
      serviceSlug: 'efp-db',
      name: 'data',
    });
    const grails = dockerVolumeName({
      projectSlug: 'grails',
      environmentSlug: 'prod',
      serviceSlug: 'grails-db',
      name: 'data',
    });
    expect(efp).toBe('efp-prod-efp-db_data');
    expect(grails).toBe('grails-prod-grails-db_data');
    expect(efp).not.toBe(grails);
  });

  it('distinguishes environments of the same project', () => {
    const prod = dockerVolumeName({
      projectSlug: 'p', environmentSlug: 'prod', serviceSlug: 's', name: 'data',
    });
    const staging = dockerVolumeName({
      projectSlug: 'p', environmentSlug: 'staging', serviceSlug: 's', name: 'data',
    });
    expect(prod).not.toBe(staging);
  });

  it('separates the volume name with _ so dash-split ambiguity cannot alias two services', () => {
    // With a dash separator these two would both be 'p-prod-web-db-data'.
    const a = dockerVolumeName({
      projectSlug: 'p', environmentSlug: 'prod', serviceSlug: 'web', name: 'db-data',
    });
    const b = dockerVolumeName({
      projectSlug: 'p', environmentSlug: 'prod', serviceSlug: 'web-db', name: 'data',
    });
    expect(a).toBe('p-prod-web_db-data');
    expect(b).toBe('p-prod-web-db_data');
    expect(a).not.toBe(b);
  });
});
