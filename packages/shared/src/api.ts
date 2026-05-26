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
    .array(z.object({ kind: z.enum(['postgres', 'redis']), name: z.string() }))
    .default([]),
});

export const CreateServiceInputSchema = z.object({
  name: z.string().min(1).max(80),
  slug: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, 'lowercase, alphanumerics and dashes'),
  kind: ServiceKindSchema.default('app'),
  template: z.string().optional(),
  image: z.string().min(1),
  env: z.record(z.string()).default({}),
  secrets: z.record(z.string()).default({}),
  hostname: z.string().optional(),
  public_port: z.number().int().positive().optional(),
  config: ServiceConfigSchema.partial().default({}),
});
export type CreateServiceInput = z.infer<typeof CreateServiceInputSchema>;

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
