import type Dockerode from 'dockerode';
import type { ContainerSpec } from '@hotbox/shared/templates';

export interface BuildContainerSpecInput {
  /** name to assign to the container (slug-deployment-role) */
  name: string;
  image: string;
  imageDigest?: string | null;
  labels: Record<string, string>;
  env: Record<string, string>;
  command?: string[];
  entrypoint?: string[];
  /** explicit container-port -> host-port bindings */
  ports?: Array<{ container: number; host?: number; protocol?: 'tcp' | 'udp'; bind?: string }>;
  /** [{ source: volumeName, target: /path, ro?: true }] — named volumes */
  volumes?: Array<{ source: string; target: string; ro?: boolean }>;
  /** [{ source: '/host/path', target: '/container/path', ro? }] — bind mounts */
  binds?: Array<{ source: string; target: string; ro?: boolean }>;
  networks?: string[];
  /** Per-network DNS aliases. The container is reachable on the network by
   *  its container name and by each alias listed here. */
  networkAliases?: Record<string, string[]>;
  restartPolicy?: 'no' | 'on-failure' | 'always' | 'unless-stopped';
  stopGracePeriodSec?: number;
  healthcheck?: {
    test: string[];
    interval_s?: number;
    timeout_s?: number;
    retries?: number;
    start_period_s?: number;
  };
  resources?: { cpu_quota?: number; mem_limit_bytes?: number };
  user?: string;
}

/**
 * Build a Dockerode ContainerCreateOptions from our normalized input.
 * Pure function — easy to unit-test without touching Docker.
 */
export function buildContainerCreateOptions(
  input: BuildContainerSpecInput,
): Dockerode.ContainerCreateOptions {
  const exposedPorts: Dockerode.ContainerCreateOptions['ExposedPorts'] = {};
  const portBindings: Record<string, Array<{ HostIp?: string; HostPort?: string }>> = {};

  for (const p of input.ports ?? []) {
    const key = `${p.container}/${p.protocol ?? 'tcp'}`;
    exposedPorts[key] = {};
    if (p.host !== undefined) {
      portBindings[key] = [{ HostIp: p.bind ?? '0.0.0.0', HostPort: String(p.host) }];
    }
  }

  const mounts: Dockerode.MountSettings[] = [];
  for (const v of input.volumes ?? []) {
    mounts.push({
      Type: 'volume',
      Source: v.source,
      Target: v.target,
      ReadOnly: v.ro ?? false,
    });
  }
  for (const b of input.binds ?? []) {
    mounts.push({
      Type: 'bind',
      Source: b.source,
      Target: b.target,
      ReadOnly: b.ro ?? false,
    });
  }

  const env = Object.entries(input.env).map(([k, v]) => `${k}=${v}`);
  const image = input.imageDigest
    ? `${input.image.split('@')[0]?.split(':')[0]}@${input.imageDigest}`
    : input.image;

  const endpointsConfig: Record<string, Dockerode.EndpointSettings> = {};
  for (const n of input.networks ?? []) {
    const aliases = input.networkAliases?.[n];
    endpointsConfig[n] = aliases?.length ? { Aliases: aliases } : {};
  }

  const options: Dockerode.ContainerCreateOptions = {
    name: input.name,
    Image: image,
    Env: env,
    Labels: input.labels,
    Cmd: input.command,
    Entrypoint: input.entrypoint,
    User: input.user,
    ExposedPorts: exposedPorts,
    StopTimeout: input.stopGracePeriodSec,
    HostConfig: {
      Mounts: mounts,
      PortBindings: portBindings,
      RestartPolicy: { Name: input.restartPolicy ?? 'on-failure', MaximumRetryCount: 0 },
      ...(input.resources?.mem_limit_bytes ? { Memory: input.resources.mem_limit_bytes } : {}),
      ...(input.resources?.cpu_quota
        ? { CpuQuota: Math.floor(input.resources.cpu_quota * 100_000), CpuPeriod: 100_000 }
        : {}),
    },
    NetworkingConfig: { EndpointsConfig: endpointsConfig },
  };

  if (input.healthcheck) {
    options.Healthcheck = {
      Test: input.healthcheck.test,
      Interval: (input.healthcheck.interval_s ?? 30) * 1_000_000_000,
      Timeout: (input.healthcheck.timeout_s ?? 5) * 1_000_000_000,
      Retries: input.healthcheck.retries ?? 3,
      StartPeriod: (input.healthcheck.start_period_s ?? 0) * 1_000_000_000,
    };
  }

  return options;
}

/**
 * Apply variable interpolation for a template ContainerSpec. The only
 * supported placeholder is `{svc}` (replaced with the service slug) and
 * `{name}` (the volume/network name from the template).
 */
export function interpolateSpec(spec: ContainerSpec, slug: string): ContainerSpec {
  const replace = (s: string) => s.replaceAll('{svc}', slug);
  return {
    ...spec,
    env: Object.fromEntries(Object.entries(spec.env).map(([k, v]) => [k, replace(v)])),
    networks: spec.networks.map(replace),
    volumes: spec.volumes.map((v) => ({ ...v, name: replace(v.name) })),
  };
}
