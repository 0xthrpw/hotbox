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

export const CreateServiceInputSchema = z.object({
  project_id: z.string().uuid(),
  environment_id: z.string().uuid(),
  name: z.string().min(1).max(80),
  slug: SlugSchema,
  kind: ServiceKindSchema.default('app'),
  template: z.string().optional(),
  image: z.string().min(1),
  env: z.record(z.string()).default({}),
  secrets: z.record(z.string()).default({}),
  hostname: z.string().optional(),
  public_port: z.number().int().positive().optional(),
  auto_subdomain: z.boolean().default(false),
  config: ServiceConfigSchema.partial().default({}),
});
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
