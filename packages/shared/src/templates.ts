import { z } from 'zod';

export const PanelSourceSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('prometheus'),
    name: z.string(),
    /** url with {svc} placeholder; e.g. http://{svc}:6061/debug/metrics/prometheus */
    url: z.string(),
  }),
  z.object({
    type: z.literal('internal'),
    name: z.string(),
    /** path on the hotbox api; e.g. /rpc-stats/{svc} */
    path: z.string(),
  }),
]);
export type PanelSource = z.infer<typeof PanelSourceSchema>;

export const PanelDefSchema = z.object({
  id: z.string(),
  label: z.string(),
  component: z.string(),
  sources: z.array(PanelSourceSchema).default([]),
});
export type PanelDef = z.infer<typeof PanelDefSchema>;

export const ContainerSpecSchema = z.object({
  role: z.string(),                                         // 'primary' | 'erigon' | 'lighthouse' | ...
  image: z.string(),
  command: z.array(z.string()).optional(),
  entrypoint: z.array(z.string()).optional(),
  env: z.record(z.string()).default({}),
  ports: z
    .array(
      z.object({
        container: z.number().int().positive(),
        host: z.number().int().positive().optional(),
        protocol: z.enum(['tcp', 'udp']).default('tcp'),
        bind: z.string().default('0.0.0.0'),
      }),
    )
    .default([]),
  volumes: z
    .array(
      z.object({
        name: z.string(),
        mountpoint: z.string(),
        ro: z.boolean().default(false),
      }),
    )
    .default([]),
  networks: z.array(z.string()).default([]),
  /** This container receives ingress traffic when the service has a hostname. */
  ingress: z.boolean().default(false),
  /**
   * If set, Traefik routes the service's hostname to the named file-provider
   * service (e.g. 'hotbox-rpc-proxy@file') instead of this container directly.
   * The proxy is responsible for forwarding to this container.
   */
  ingress_via: z.string().optional(),
});
export type ContainerSpec = z.infer<typeof ContainerSpecSchema>;

export const TemplateSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().default(''),
  containers: z.array(ContainerSpecSchema).min(1),
  volumes: z
    .array(
      z.object({
        name: z.string(),
        driver: z.string().default('local'),
      }),
    )
    .default([]),
  networks: z
    .array(
      z.object({
        name: z.string(),
        internal: z.boolean().default(true),
      }),
    )
    .default([]),
  /**
   * Files generated on first deploy (e.g. jwt.hex). Idempotent — bootstrap
   * runs every reconcile but the underlying script no-ops if the file exists.
   *
   * `volume` names a template volume; the bootstrap container mounts it at /v
   * and writes /v/{path}.
   */
  bootstrap: z
    .array(
      z.object({
        volume: z.string(),
        path: z.string(),
        kind: z.enum(['random_hex', 'random_bytes']),
        size: z.number().int().positive(),
        mode: z.string().default('0640'),
      }),
    )
    .default([]),
  panels: z.array(PanelDefSchema).default([]),
  tokenScopes: z.array(z.string()).default([]),
});
export type Template = z.infer<typeof TemplateSchema>;
