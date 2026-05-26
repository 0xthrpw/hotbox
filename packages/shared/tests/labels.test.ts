import { describe, it, expect } from 'vitest';
import {
  labelsFor,
  managedFilter,
  LABEL_MANAGED,
  LABEL_SERVICE_ID,
  LABEL_DEPLOYMENT_ID,
  LABEL_VERSION,
  LABEL_ROLE,
} from '../src/labels.js';

describe('labels', () => {
  it('labelsFor includes the managed flag and identity labels', () => {
    const out = labelsFor({
      serviceId: 'svc-1',
      serviceSlug: 'my-app',
      deploymentId: 'dep-9',
      version: 3,
      role: 'primary',
    });
    expect(out[LABEL_MANAGED]).toBe('true');
    expect(out[LABEL_SERVICE_ID]).toBe('svc-1');
    expect(out[LABEL_DEPLOYMENT_ID]).toBe('dep-9');
    expect(out[LABEL_VERSION]).toBe('3');
    expect(out[LABEL_ROLE]).toBe('primary');
  });

  it('labelsFor omits role when not provided', () => {
    const out = labelsFor({
      serviceId: 's', serviceSlug: 'a', deploymentId: 'd', version: 1,
    });
    expect(LABEL_ROLE in out).toBe(false);
  });

  it('managedFilter targets the hotbox.managed label', () => {
    const f = managedFilter();
    expect(f.label).toEqual([`${LABEL_MANAGED}=true`]);
  });
});
