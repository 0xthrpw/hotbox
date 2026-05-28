import type Dockerode from 'dockerode';
import type { Service, ServiceWithContext, Deployment, HotboxDb } from '@hotbox/db';
import {
  type Template,
  type ContainerSpec,
  loadTemplate,
  interpolateTemplate,
  LABEL_MANAGED,
} from '@hotbox/shared';
import { open, type KeyRing } from '@hotbox/crypto';
import { buildContainerCreateOptions, pullAndResolveDigest, type BuildContainerSpecInput } from '@hotbox/docker';

export interface RolePlan {
  role: string;
  image: string;
  container: ContainerSpec | null;        // null for non-template legacy 'primary'
}

/**
 * Compute the list of roles a service should have, based on either its
 * template or (for non-template services) a synthesized 'primary' role.
 */
export async function planRoles(service: Service, deployment: Deployment): Promise<RolePlan[]> {
  if (service.template) {
    const template = interpolateTemplate(await loadTemplate(service.template), service.slug);
    return template.containers.map((c) => ({
      role: c.role,
      image: c.image,
      container: c,
    }));
  }
  return [{ role: 'primary', image: deployment.image, container: null }];
}

/** Idempotent network create. */
export async function ensureNetwork(
  docker: Dockerode,
  name: string,
  options: { internal?: boolean } = {},
): Promise<void> {
  try {
    await docker.createNetwork({
      Name: name,
      Driver: 'bridge',
      Internal: options.internal ?? false,
      Labels: { [LABEL_MANAGED]: 'true' },
    });
  } catch (err) {
    if (!isAlreadyExists(err)) throw err;
  }
}

/** Idempotent named volume create. */
export async function ensureVolume(docker: Dockerode, name: string): Promise<void> {
  try {
    await docker.createVolume({
      Name: name,
      Driver: 'local',
      Labels: { [LABEL_MANAGED]: 'true' },
    });
  } catch (err) {
    if (!isAlreadyExists(err)) throw err;
  }
}

/**
 * Run a one-shot alpine container that creates the bootstrap file inside the
 * named volume — if it doesn't already exist. Safe to call on every reconcile.
 */
export async function runBootstrap(
  docker: Dockerode,
  step: Template['bootstrap'][number],
): Promise<void> {
  const filepath = `/v/${step.path}`;
  const lastSlash = step.path.lastIndexOf('/');
  const dir = lastSlash >= 0 ? `/v/${step.path.slice(0, lastSlash)}` : '/v';

  const generate =
    step.kind === 'random_hex'
      ? `head -c ${step.size} /dev/urandom | od -A n -t x1 | tr -d ' \\n' > ${filepath}`
      : `head -c ${step.size} /dev/urandom > ${filepath}`;

  const script = [
    `set -e`,
    `test -f ${filepath} && exit 0`,
    `mkdir -p ${dir}`,
    generate,
    `chmod ${step.mode} ${filepath}`,
  ].join('; ');

  // best-effort pull (alpine is usually cached)
  await pullAndResolveDigest(docker, 'alpine:3').catch(() => {});

  const container = await docker.createContainer({
    Image: 'alpine:3',
    Cmd: ['sh', '-c', script],
    HostConfig: {
      AutoRemove: true,
      Mounts: [{ Type: 'volume', Source: step.volume, Target: '/v' }],
    },
    Labels: { [LABEL_MANAGED]: 'true', 'hotbox.bootstrap': 'true' },
  });
  try {
    await container.start();
    const result = await container.wait();
    if (result.StatusCode !== 0) {
      throw new Error(
        `bootstrap failed for volume=${step.volume} path=${step.path}: exit ${result.StatusCode}`,
      );
    }
  } catch (err) {
    // AutoRemove may already have killed the container
    try { await container.remove({ force: true }); } catch { /* gone */ }
    throw err;
  }
}

/**
 * Build the dockerode container-create options for a role.
 * Caller layers labels (hotbox.* + traefik.*) on top of `baseLabels`.
 *
 * Networks: a role joins its template-declared networks PLUS any extras
 * declared on the deployment (used by managed-sibling pattern to add the
 * shared parent-child network). Aliases are set so that `<slug>` and
 * `<slug>-<role>` are both reachable as DNS names on every joined network.
 */
export function buildOptionsForRole(opts: {
  service: ServiceWithContext;
  deployment: Deployment;
  role: string;
  container: ContainerSpec | null;
  digest: string | null;
  baseLabels: Record<string, string>;
  version: number;
  injectedEnv: Record<string, string>;     // decrypted secrets, merged last
}): BuildContainerSpecInput {
  // Container name is namespaced by project + env so two services with the
  // same slug in different envs don't collide on the docker host (the
  // services table is unique per (project, env, slug), not globally).
  const name = `${opts.service.project_slug}-${opts.service.environment_slug}-${opts.service.slug}-${opts.role}-v${opts.version}`;
  const networkRefs = Array.isArray(opts.deployment.network_refs) ? opts.deployment.network_refs : [];
  const deploymentNetworks = networkRefs.map((n) => n.name);

  const aliasesFor = (networks: string[]): Record<string, string[]> => {
    const aliases = [opts.service.slug, `${opts.service.slug}-${opts.role}`];
    const out: Record<string, string[]> = {};
    for (const n of networks) out[n] = aliases;
    return out;
  };

  if (opts.container) {
    const c = opts.container;
    const networks = [...c.networks, ...deploymentNetworks];
    return {
      name,
      image: c.image,
      imageDigest: opts.digest,
      labels: opts.baseLabels,
      env: { ...c.env, ...opts.deployment.env_snapshot, ...opts.injectedEnv },
      command: c.command,
      entrypoint: c.entrypoint,
      ports: c.ports.map((p) => ({
        container: p.container,
        host: p.host,
        protocol: p.protocol,
        bind: p.bind,
      })),
      volumes: c.volumes.map((v) => ({
        source: v.name,
        target: v.mountpoint,
        ro: v.ro,
      })),
      networks,
      networkAliases: aliasesFor(networks),
      restartPolicy: opts.service.config.restart_policy ?? 'on-failure',
      stopGracePeriodSec: opts.service.config.stop_grace_period_sec ?? 30,
    };
  }

  // legacy non-template 'primary' role
  const networks = deploymentNetworks;
  return {
    name,
    image: opts.deployment.image,
    imageDigest: opts.digest,
    labels: opts.baseLabels,
    env: { ...opts.deployment.env_snapshot, ...opts.injectedEnv },
    ports: opts.service.public_port
      ? [{ container: opts.service.public_port, protocol: 'tcp' }]
      : [],
    volumes: (Array.isArray(opts.deployment.volume_refs) ? opts.deployment.volume_refs : []).map((v) => ({
      source: v.volume_id,
      target: v.mountpoint,
      ro: v.ro,
    })),
    networks,
    networkAliases: aliasesFor(networks),
    restartPolicy: opts.service.config.restart_policy ?? 'on-failure',
    stopGracePeriodSec: opts.service.config.stop_grace_period_sec ?? 30,
    healthcheck:
      opts.service.config.healthcheck?.type === 'http' &&
      opts.service.public_port &&
      opts.service.config.healthcheck.path
        ? {
            test: [
              'CMD-SHELL',
              `wget -qO- http://127.0.0.1:${opts.service.public_port}${opts.service.config.healthcheck.path} || exit 1`,
            ],
            interval_s: opts.service.config.healthcheck.interval_s,
            retries: opts.service.config.healthcheck.retries,
          }
        : undefined,
  };
}

/**
 * Decrypt the deployment's secret_refs through the keyring and return the
 * map of env-var-name → plaintext. Only secrets with inject_as='env' are
 * returned (file-mounts not yet supported).
 */
export async function decryptSecretEnv(
  db: HotboxDb,
  keyring: KeyRing,
  refs: Deployment['secret_refs'],
): Promise<Record<string, string>> {
  const list = refs as unknown as Array<{ secret_id: string; inject_as?: string; key?: string }>;
  if (!Array.isArray(list) || list.length === 0) return {};
  const envRefs = list.filter((r) => (r.inject_as ?? 'env') === 'env');
  if (envRefs.length === 0) return {};

  const rows = await db
    .selectFrom('secrets')
    .select(['id', 'key', 'ciphertext', 'nonce', 'key_version'])
    .where('id', 'in', envRefs.map((r) => r.secret_id))
    .execute();

  const out: Record<string, string> = {};
  for (const ref of envRefs) {
    const row = rows.find((r) => r.id === ref.secret_id);
    if (!row) continue;
    const plain = open(keyring, {
      ciphertext: row.ciphertext,
      nonce: row.nonce,
      keyVersion: row.key_version,
    });
    out[ref.key ?? row.key] = plain;
  }
  return out;
}

/**
 * Ensure all networks declared on a deployment exist, respecting the internal
 * flag. Template-level networks are handled separately by ensureTemplateInfra.
 */
export async function ensureDeploymentInfra(
  docker: Dockerode,
  deployment: Deployment,
): Promise<void> {
  const networkRefs = Array.isArray(deployment.network_refs) ? deployment.network_refs : [];
  for (const n of networkRefs) {
    await ensureNetwork(docker, n.name, { internal: n.internal });
  }
}

/**
 * Resolve the digest for one role on one deployment. If the deployment already
 * has a digest stored for this role, use it; otherwise pull, resolve, and
 * persist back to the deployment row.
 */
export async function ensureRoleDigest(
  db: HotboxDb,
  docker: Dockerode,
  deployment: Deployment,
  role: string,
  image: string,
): Promise<string> {
  const digests = (deployment.container_digests ?? {}) as Record<string, string>;
  if (digests[role]) {
    // best-effort refresh in the background; don't block on it
    pullAndResolveDigest(docker, image).catch(() => {});
    return digests[role];
  }
  const digest = await pullAndResolveDigest(docker, image);
  await db
    .updateTable('deployments')
    .set({ container_digests: { ...digests, [role]: digest } })
    .where('id', '=', deployment.id)
    .execute();
  return digest;
}

/**
 * Ensure all template-declared networks and volumes exist, and run all
 * bootstrap steps (idempotent). No-op for non-template services.
 */
export async function ensureTemplateInfra(
  docker: Dockerode,
  service: Service,
): Promise<Template | null> {
  if (!service.template) return null;
  const template = interpolateTemplate(await loadTemplate(service.template), service.slug);
  for (const v of template.volumes) await ensureVolume(docker, v.name);
  for (const n of template.networks) await ensureNetwork(docker, n.name, { internal: n.internal });
  for (const b of template.bootstrap) await runBootstrap(docker, b);
  return template;
}

function isAlreadyExists(err: unknown): boolean {
  const e = err as { statusCode?: number; message?: string };
  return e.statusCode === 409 || /already exists/i.test(e.message ?? '');
}

export { buildContainerCreateOptions };
