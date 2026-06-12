import { z } from 'zod';

export const ServiceKindSchema = z.enum(['app', 'managed_pg', 'managed_redis']);
export const DesiredStateSchema = z.enum(['running', 'stopped', 'archived']);
export const CurrentStateSchema = z.enum([
  'pending', 'creating', 'starting', 'running', 'degraded', 'stopped', 'failed',
]);
export type ServiceKind = z.infer<typeof ServiceKindSchema>;
export type DesiredState = z.infer<typeof DesiredStateSchema>;
export type CurrentState = z.infer<typeof CurrentStateSchema>;
export type TokenKind = 'api' | 'rpc';
export type TokenTier = 'public' | 'internal';

export const HealthcheckSchema = z.object({
  type: z.enum(['http', 'cmd']),
  path: z.string().optional(),
  cmd: z.array(z.string()).optional(),
  interval_s: z.number().int().positive().default(30),
  retries: z.number().int().nonnegative().default(3),
});

export const ServiceConfigSchema = z.object({
  restart_policy: z.enum(['no', 'on-failure', 'always', 'unless-stopped']).default('on-failure'),
  replace_strategy: z.enum(['start_then_stop', 'stop_then_start']).default('start_then_stop'),
  resources: z
    .object({
      cpu_quota: z.number().positive().optional(),
      mem_limit_bytes: z.number().int().positive().optional(),
    })
    .partial()
    .optional(),
  healthcheck: HealthcheckSchema.optional(),
  stop_grace_period_sec: z.number().int().positive().default(30),
  requires: z
    .array(
      z.object({
        kind: z.enum(['postgres', 'redis']),
        name: z
          .string()
          .min(1)
          .max(30)
          .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]?$/, 'lowercase, alphanumerics and dashes'),
      }),
    )
    .default([]),
});

// Shared by projects, environments, services — same character class.
const SlugSchema = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, 'lowercase, alphanumerics and dashes');

export const CreateProjectInputSchema = z.object({
  name: z.string().min(1).max(80),
  slug: SlugSchema,
});
export type CreateProjectInput = z.infer<typeof CreateProjectInputSchema>;

export const CreateEnvironmentInputSchema = z.object({
  name: z.string().min(1).max(80),
  slug: SlugSchema,
});
export type CreateEnvironmentInput = z.infer<typeof CreateEnvironmentInputSchema>;

export const DuplicateEnvironmentInputSchema = z.object({
  name: z.string().min(1).max(80),
  slug: SlugSchema,
});
export type DuplicateEnvironmentInput = z.infer<typeof DuplicateEnvironmentInputSchema>;

export const ImageSourceSchema = z.enum(['image', 'github']);
export type ImageSource = z.infer<typeof ImageSourceSchema>;

export const GithubSourceInputSchema = z.object({
  // owner/repo — GitHub's allowed chars are alphanumerics, dash, underscore, dot.
  repo_full_name: z
    .string()
    .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'must be owner/repo'),
  // Git-ref-safe and, critically, cannot start with '-' so it can't be
  // misread as a flag by `git clone --branch <value>` (we use execFile with
  // an arg array, but this is belt-and-suspenders against a leading dash).
  branch: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[A-Za-z0-9_][A-Za-z0-9._/-]*$/, 'invalid branch name'),
  dockerfile_path: z.string().min(1).max(255).default('Dockerfile'),
  build_context: z.string().min(1).max(255).default('.'),
});
export type GithubSourceInput = z.infer<typeof GithubSourceInputSchema>;

export const CreateServiceInputSchema = z
  .object({
    project_id: z.string().uuid(),
    environment_id: z.string().uuid(),
    name: z.string().min(1).max(80),
    slug: SlugSchema,
    kind: ServiceKindSchema.default('app'),
    template: z.string().optional(),
    image_source: ImageSourceSchema.default('image'),
    // Required when image_source='image'; ignored for github (the worker
    // assigns the built local image). Enforced by the refine below.
    image: z.string().min(1).optional(),
    github: GithubSourceInputSchema.optional(),
    env: z.record(z.string()).default({}),
    secrets: z.record(z.string()).default({}),
    hostname: z.string().optional(),
    public_port: z.number().int().positive().optional(),
    auto_subdomain: z.boolean().default(false),
    config: ServiceConfigSchema.partial().default({}),
  })
  .refine((v) => v.image_source !== 'image' || (v.image && v.image.length > 0), {
    message: 'image is required when image_source is "image"',
    path: ['image'],
  })
  .refine((v) => v.image_source !== 'github' || v.github !== undefined, {
    message: 'github is required when image_source is "github"',
    path: ['github'],
  })
  .refine(
    (v) => v.image_source !== 'github' || (v.config?.requires ?? []).length === 0,
    {
      // Managed siblings aren't supported on github-built services yet — the
      // sibling wiring would have to attach to a not-yet-built first deploy.
      // Point operators at variables instead (set DATABASE_URL etc.).
      message:
        'managed siblings (requires) are not supported on github services yet — run the dependency as its own service and wire it with a variable',
      path: ['config', 'requires'],
    },
  );
export type CreateServiceInput = z.infer<typeof CreateServiceInputSchema>;

/**
 * Patch shape for the service-detail "edit ingress" action. All three fields
 * are optional and independently nullable so an operator can clear a custom
 * hostname or flip auto_subdomain without touching the others. At least one
 * field must be present.
 */
export const UpdateIngressInputSchema = z
  .object({
    hostname: z.string().nullable().optional(),
    public_port: z.number().int().positive().nullable().optional(),
    auto_subdomain: z.boolean().optional(),
  })
  .refine(
    (v) => v.hostname !== undefined || v.public_port !== undefined || v.auto_subdomain !== undefined,
    { message: 'must update at least one field' },
  );
export type UpdateIngressInput = z.infer<typeof UpdateIngressInputSchema>;

export const CreateDeploymentInputSchema = z.object({
  /** Optional — defaults to the previous deployment's image (= redeploy). */
  image: z.string().min(1).optional(),
  env: z.record(z.string()).optional(),
});
export type CreateDeploymentInput = z.infer<typeof CreateDeploymentInputSchema>;

export const CreateTokenInputSchema = z.object({
  name: z.string().min(1).max(80),
  kind: z.enum(['api', 'rpc']),
  service_id: z.string().uuid().optional(),
  scopes: z.array(z.string()).default([]),
  tier: z.enum(['public', 'internal']).default('public'),
  rate_limit_per_min: z.number().int().positive().optional(),
  expires_at: z.string().datetime().optional(),
});
export type CreateTokenInput = z.infer<typeof CreateTokenInputSchema>;

export const LoginInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});
export type LoginInput = z.infer<typeof LoginInputSchema>;

export const CreateInviteInputSchema = z.object({
  note: z.string().max(80).optional(),
  expires_in_days: z.number().int().min(1).max(30).default(7),
});
export type CreateInviteInput = z.infer<typeof CreateInviteInputSchema>;

export const SignupInputSchema = z.object({
  token: z.string().min(20).max(128),
  email: z.string().email(),
  password: z.string().min(10).max(256),
});
export type SignupInput = z.infer<typeof SignupInputSchema>;

// POSIX env var name: letter or underscore, then letters/digits/underscores.
// We deliberately reject lowercase to head off accidental Foo=bar entries
// that would shadow uppercase ones; container env is case-sensitive but
// almost everything uses SCREAMING_SNAKE_CASE by convention.
const EnvVarKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Z_][A-Z0-9_]*$/, 'UPPERCASE letters, digits, underscores; cannot start with a digit');

export const VariableScopeSchema = z.enum(['project', 'environment', 'service']);
export type VariableScope = z.infer<typeof VariableScopeSchema>;

export const CreateVariableInputSchema = z
  .object({
    key: EnvVarKeySchema,
    value: z.string().max(64 * 1024),
    is_secret: z.boolean().default(false),
  });
export type CreateVariableInput = z.infer<typeof CreateVariableInputSchema>;

export const UpdateVariableInputSchema = z
  .object({
    value: z.string().max(64 * 1024).optional(),
    is_secret: z.boolean().optional(),
  })
  .refine((v) => v.value !== undefined || v.is_secret !== undefined, {
    message: 'must update at least one field',
  });
export type UpdateVariableInput = z.infer<typeof UpdateVariableInputSchema>;
