import { describe, it, expect } from 'vitest';
import {
  CreateProjectInputSchema,
  CreateEnvironmentInputSchema,
  DuplicateEnvironmentInputSchema,
  CreateServiceInputSchema,
} from '../src/api.js';

describe('CreateProjectInputSchema', () => {
  it('accepts a valid slug + name', () => {
    const out = CreateProjectInputSchema.parse({ slug: 'widget-sales', name: 'Widget Sales' });
    expect(out.slug).toBe('widget-sales');
    expect(out.name).toBe('Widget Sales');
  });

  it('rejects an uppercase slug', () => {
    expect(() => CreateProjectInputSchema.parse({ slug: 'Widget', name: 'x' })).toThrow();
  });

  it('rejects a slug with leading/trailing dash', () => {
    expect(() => CreateProjectInputSchema.parse({ slug: '-bad', name: 'x' })).toThrow();
    expect(() => CreateProjectInputSchema.parse({ slug: 'bad-', name: 'x' })).toThrow();
  });

  it('rejects an empty name', () => {
    expect(() => CreateProjectInputSchema.parse({ slug: 'ok', name: '' })).toThrow();
  });
});

describe('CreateEnvironmentInputSchema / DuplicateEnvironmentInputSchema', () => {
  it('share the same constraints (slug + name)', () => {
    const input = { slug: 'production', name: 'Production' };
    expect(CreateEnvironmentInputSchema.parse(input)).toEqual(input);
    expect(DuplicateEnvironmentInputSchema.parse(input)).toEqual(input);
  });

  it('rejects too-long names', () => {
    expect(() =>
      CreateEnvironmentInputSchema.parse({ slug: 'ok', name: 'x'.repeat(81) }),
    ).toThrow();
  });
});

describe('CreateServiceInputSchema', () => {
  const baseValid = {
    project_id: '11111111-1111-1111-1111-111111111111',
    environment_id: '22222222-2222-2222-2222-222222222222',
    name: 'My API',
    slug: 'my-api',
    image: 'ghcr.io/org/api:latest',
  };

  it('requires project_id and environment_id (uuids)', () => {
    expect(() => CreateServiceInputSchema.parse({ ...baseValid, project_id: 'not-a-uuid' })).toThrow();
    expect(() =>
      CreateServiceInputSchema.parse({ ...baseValid, environment_id: 'nope' }),
    ).toThrow();

    const { project_id: _p, ...noProject } = baseValid;
    expect(() => CreateServiceInputSchema.parse(noProject)).toThrow();
    const { environment_id: _e, ...noEnv } = baseValid;
    expect(() => CreateServiceInputSchema.parse(noEnv)).toThrow();
  });

  it('accepts a minimal valid payload and defaults kind=app', () => {
    const out = CreateServiceInputSchema.parse(baseValid);
    expect(out.project_id).toBe(baseValid.project_id);
    expect(out.environment_id).toBe(baseValid.environment_id);
    expect(out.kind).toBe('app');
    expect(out.env).toEqual({});
  });
});
