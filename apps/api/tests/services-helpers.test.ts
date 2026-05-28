import { describe, it, expect } from 'vitest';
import { siblingNetworkName } from '../src/routes/services.js';

describe('siblingNetworkName', () => {
  it('namespaces by project + env + parent slug so two envs do not collide on the host', () => {
    const prod = siblingNetworkName({
      projectSlug: 'widget-sales',
      environmentSlug: 'production',
      parentSlug: 'api',
    });
    const dev = siblingNetworkName({
      projectSlug: 'widget-sales',
      environmentSlug: 'dev',
      parentSlug: 'api',
    });
    expect(prod).toBe('widget-sales-production-api-net');
    expect(dev).toBe('widget-sales-dev-api-net');
    expect(prod).not.toBe(dev);
  });

  it('keeps the -net suffix that Docker network listings rely on for filtering', () => {
    const name = siblingNetworkName({
      projectSlug: 'p',
      environmentSlug: 'e',
      parentSlug: 's',
    });
    expect(name.endsWith('-net')).toBe(true);
  });
});
