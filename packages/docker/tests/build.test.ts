import { describe, it, expect } from 'vitest';
import { isLocalImage, LOCAL_IMAGE_PREFIX } from '../src/build.js';

describe('isLocalImage', () => {
  it('flags host-built images by the hotbox-local/ prefix', () => {
    expect(isLocalImage('hotbox-local/widget-sales-production-api:abc1234')).toBe(true);
  });

  it('does not flag registry images', () => {
    expect(isLocalImage('ghcr.io/org/app:latest')).toBe(false);
    expect(isLocalImage('postgres:16-alpine')).toBe(false);
    expect(isLocalImage('nginx@sha256:deadbeef')).toBe(false);
  });

  it('prefix constant matches the tag the build worker emits', () => {
    expect(LOCAL_IMAGE_PREFIX).toBe('hotbox-local/');
    expect(`${LOCAL_IMAGE_PREFIX}proj-env-slug:sha`.startsWith(LOCAL_IMAGE_PREFIX)).toBe(true);
  });
});
