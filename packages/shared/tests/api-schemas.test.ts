import { describe, it, expect } from 'vitest';
import {
  CreateProjectInputSchema,
  CreateEnvironmentInputSchema,
  DuplicateEnvironmentInputSchema,
  CreateServiceInputSchema,
  CreateVariableInputSchema,
  UpdateVariableInputSchema,
  CreateInviteInputSchema,
  SignupInputSchema,
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
    expect(out.image_source).toBe('image');
  });

  it('rejects an image source without an image', () => {
    const { image: _image, ...noImage } = baseValid;
    expect(() => CreateServiceInputSchema.parse(noImage)).toThrow();
  });
});

describe('CreateServiceInputSchema — github source', () => {
  const ghBase = {
    project_id: '11111111-1111-1111-1111-111111111111',
    environment_id: '22222222-2222-2222-2222-222222222222',
    name: 'My API',
    slug: 'my-api',
    image_source: 'github' as const,
    github: { repo_full_name: 'vercel/next.js', branch: 'main' },
  };

  it('accepts a github source without an image and defaults dockerfile/context', () => {
    const out = CreateServiceInputSchema.parse(ghBase);
    expect(out.image_source).toBe('github');
    expect(out.github?.dockerfile_path).toBe('Dockerfile');
    expect(out.github?.build_context).toBe('.');
  });

  it('requires the github object when image_source is github', () => {
    const { github: _g, ...noGithub } = ghBase;
    expect(() => CreateServiceInputSchema.parse(noGithub)).toThrow();
  });

  it('rejects a malformed repo_full_name', () => {
    expect(() =>
      CreateServiceInputSchema.parse({ ...ghBase, github: { repo_full_name: 'not-a-repo', branch: 'main' } }),
    ).toThrow();
  });

  it('rejects a branch that could be read as a flag', () => {
    expect(() =>
      CreateServiceInputSchema.parse({ ...ghBase, github: { repo_full_name: 'a/b', branch: '--upload-pack=x' } }),
    ).toThrow();
  });

  it('rejects managed siblings (requires) on a github service', () => {
    expect(() =>
      CreateServiceInputSchema.parse({
        ...ghBase,
        config: { requires: [{ kind: 'postgres', name: 'db' }] },
      }),
    ).toThrow();
  });

  it('allows a github service with no requires', () => {
    const out = CreateServiceInputSchema.parse({ ...ghBase, config: {} });
    expect(out.image_source).toBe('github');
  });
});

describe('CreateVariableInputSchema', () => {
  it('accepts a plain UPPER_SNAKE key/value', () => {
    const out = CreateVariableInputSchema.parse({ key: 'DATABASE_URL', value: 'postgres://...' });
    expect(out.is_secret).toBe(false);
  });

  it('accepts an explicit is_secret=true', () => {
    const out = CreateVariableInputSchema.parse({ key: 'STRIPE_SK', value: 'sk_live_x', is_secret: true });
    expect(out.is_secret).toBe(true);
  });

  it('rejects a lowercase key', () => {
    expect(() => CreateVariableInputSchema.parse({ key: 'database_url', value: 'x' })).toThrow();
  });

  it('rejects a key starting with a digit', () => {
    expect(() => CreateVariableInputSchema.parse({ key: '1API', value: 'x' })).toThrow();
  });

  it('rejects a key with a dash', () => {
    expect(() => CreateVariableInputSchema.parse({ key: 'API-KEY', value: 'x' })).toThrow();
  });

  it('accepts underscores and digits in the body of the key', () => {
    const out = CreateVariableInputSchema.parse({ key: 'AWS_S3_BUCKET_2', value: 'x' });
    expect(out.key).toBe('AWS_S3_BUCKET_2');
  });

  it('accepts a leading underscore', () => {
    const out = CreateVariableInputSchema.parse({ key: '_INTERNAL', value: 'x' });
    expect(out.key).toBe('_INTERNAL');
  });
});

describe('CreateInviteInputSchema', () => {
  it('accepts an empty body and defaults expiry to 7 days', () => {
    const out = CreateInviteInputSchema.parse({});
    expect(out.expires_in_days).toBe(7);
    expect(out.note).toBeUndefined();
  });

  it('accepts a note and a custom expiry', () => {
    const out = CreateInviteInputSchema.parse({ note: 'alice', expires_in_days: 3 });
    expect(out.note).toBe('alice');
    expect(out.expires_in_days).toBe(3);
  });

  it('rejects an expiry outside 1–30 days', () => {
    expect(() => CreateInviteInputSchema.parse({ expires_in_days: 0 })).toThrow();
    expect(() => CreateInviteInputSchema.parse({ expires_in_days: 31 })).toThrow();
  });

  it('rejects a note over 80 chars', () => {
    expect(() => CreateInviteInputSchema.parse({ note: 'x'.repeat(81) })).toThrow();
  });
});

describe('SignupInputSchema', () => {
  const valid = {
    token: 'a'.repeat(43),
    email: 'alice@example.com',
    password: 'correct-horse-battery',
  };

  it('accepts a valid payload', () => {
    expect(SignupInputSchema.parse(valid)).toEqual(valid);
  });

  it('rejects a password under 10 chars', () => {
    expect(() => SignupInputSchema.parse({ ...valid, password: 'short9pwd' })).toThrow();
  });

  it('rejects a malformed email', () => {
    expect(() => SignupInputSchema.parse({ ...valid, email: 'not-an-email' })).toThrow();
  });

  it('rejects a too-short token', () => {
    expect(() => SignupInputSchema.parse({ ...valid, token: 'tiny' })).toThrow();
  });
});

describe('UpdateVariableInputSchema', () => {
  it('accepts a value-only update', () => {
    expect(UpdateVariableInputSchema.parse({ value: 'new' })).toEqual({ value: 'new' });
  });

  it('accepts an is_secret-only update (flip)', () => {
    expect(UpdateVariableInputSchema.parse({ is_secret: true })).toEqual({ is_secret: true });
  });

  it('rejects an empty body — at least one field is required', () => {
    expect(() => UpdateVariableInputSchema.parse({})).toThrow();
  });
});
