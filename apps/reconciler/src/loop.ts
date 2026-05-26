import type Dockerode from 'dockerode';
import type { HotboxDb, Service, Deployment } from '@hotbox/db';
import {
  listManagedContainers,
  pullAndResolveDigest,
  buildContainerCreateOptions,
  tailEvents,
  type ManagedContainerInfo,
} from '@hotbox/docker';
import { labelsFor, LABEL_DEPLOYMENT_ID, LABEL_VERSION } from '@hotbox/shared/labels';
import { traefikLabelsFor } from './traefik-labels.js';

const TICK_INTERVAL_MS = 5_000;

export interface ReconcilerOptions {
  db: HotboxDb;
  docker: Dockerode;
  hostId: string;
  logger?: { info: (msg: string, meta?: unknown) => void; error: (msg: string, meta?: unknown) => void };
}

export class Reconciler {
  private readonly db: HotboxDb;
  private readonly docker: Dockerode;
  private readonly hostId: string;
  private readonly log: NonNullable<ReconcilerOptions['logger']>;
  private timer: NodeJS.Timeout | null = null;
  private eventsAbort: AbortController | null = null;
  private inFlight = new Set<string>();
  private dirty = new Set<string>();

  constructor(opts: ReconcilerOptions) {
    this.db = opts.db;
    this.docker = opts.docker;
    this.hostId = opts.hostId;
    this.log = opts.logger ?? { info: () => {}, error: () => {} };
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick().catch((e) => this.log.error('tick failed', e)), TICK_INTERVAL_MS);
    this.eventsAbort = new AbortController();
    void this.tailDockerEvents(this.eventsAbort.signal);
    void this.tick();
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.eventsAbort) { this.eventsAbort.abort(); this.eventsAbort = null; }
  }

  /** Schedule a reconcile for one service ASAP. Coalesces if a tick is already running. */
  reconcileSoon(serviceId: string): void {
    this.dirty.add(serviceId);
    queueMicrotask(() => this.tick().catch((e) => this.log.error('on-demand tick failed', e)));
  }

  private async tailDockerEvents(signal: AbortSignal): Promise<void> {
    for await (const ev of tailEvents(this.docker, { abort: signal })) {
      const serviceId = ev.Actor?.Attributes?.['hotbox.service_id'];
      if (serviceId) this.reconcileSoon(serviceId);
    }
  }

  private async tick(): Promise<void> {
    const services = await this.db
      .selectFrom('services')
      .selectAll()
      .where('host_id', '=', this.hostId)
      .where('archived_at', 'is', null)
      .execute();

    const containers = await listManagedContainers(this.docker);
    const containersByService = new Map<string, ManagedContainerInfo[]>();
    for (const c of containers) {
      if (!c.serviceId) continue;
      const arr = containersByService.get(c.serviceId) ?? [];
      arr.push(c);
      containersByService.set(c.serviceId, arr);
    }

    const dirtyIds = Array.from(this.dirty);
    this.dirty.clear();
    const dirtySet = new Set(dirtyIds);

    for (const svc of services) {
      if (dirtyIds.length > 0 && !dirtySet.has(svc.id)) continue;
      if (this.inFlight.has(svc.id)) continue;
      this.inFlight.add(svc.id);
      try {
        await this.applyService(svc, containersByService.get(svc.id) ?? []);
      } catch (err) {
        this.log.error(`apply ${svc.slug} failed`, err);
      } finally {
        this.inFlight.delete(svc.id);
      }
    }
  }

  private async applyService(service: Service, observed: ManagedContainerInfo[]): Promise<void> {
    const latest = await this.db
      .selectFrom('deployments')
      .selectAll()
      .where('service_id', '=', service.id)
      .where('status', 'in', ['pending', 'active'])
      .orderBy('version', 'desc')
      .executeTakeFirst();

    if (service.desired_state === 'stopped' || service.desired_state === 'archived') {
      for (const c of observed) await this.removeContainer(c.id);
      await this.db.updateTable('services').set({ current_state: 'stopped' }).where('id', '=', service.id).execute();
      return;
    }

    if (!latest) {
      await this.db
        .updateTable('services')
        .set({ current_state: 'pending' })
        .where('id', '=', service.id)
        .execute();
      return;
    }

    const matching = observed.filter(
      (c) => c.labels[LABEL_DEPLOYMENT_ID] === latest.id && c.labels[LABEL_VERSION] === String(latest.version),
    );
    const stale = observed.filter((c) => !matching.includes(c));

    if (service.config.replace_strategy === 'stop_then_start') {
      for (const c of stale) await this.removeContainer(c.id);
    }

    if (matching.length === 0) {
      await this.startDeployment(service, latest);
    }

    if (service.config.replace_strategy !== 'stop_then_start') {
      for (const c of stale) await this.removeContainer(c.id);
    }
  }

  private async startDeployment(service: Service, deployment: Deployment): Promise<void> {
    let digest = deployment.image_digest;
    if (!digest) {
      digest = await pullAndResolveDigest(this.docker, deployment.image);
      await this.db
        .updateTable('deployments')
        .set({ image_digest: digest })
        .where('id', '=', deployment.id)
        .execute();
    } else {
      await pullAndResolveDigest(this.docker, deployment.image).catch(() => {});
    }

    const labels: Record<string, string> = {
      ...labelsFor({
        serviceId: service.id,
        serviceSlug: service.slug,
        deploymentId: deployment.id,
        version: deployment.version,
        role: 'primary',
      }),
      ...traefikLabelsFor(service, { requireAuth: !!service.config.requires?.some(() => false) }),
    };

    const options = buildContainerCreateOptions({
      name: `${service.slug}-v${deployment.version}`,
      image: deployment.image,
      imageDigest: digest,
      labels,
      env: deployment.env_snapshot,
      ports: service.public_port
        ? [{ container: service.public_port, protocol: 'tcp' }]
        : [],
      volumes: deployment.volume_refs.map((v) => ({
        source: v.volume_id,
        target: v.mountpoint,
        ro: v.ro,
      })),
      networks: deployment.network_refs.map((n) => n.alias ?? n.network_id),
      restartPolicy: service.config.restart_policy ?? 'on-failure',
      stopGracePeriodSec: service.config.stop_grace_period_sec ?? 30,
      healthcheck: service.config.healthcheck?.type === 'http' && service.public_port && service.config.healthcheck.path
        ? {
            test: ['CMD-SHELL', `wget -qO- http://127.0.0.1:${service.public_port}${service.config.healthcheck.path} || exit 1`],
            interval_s: service.config.healthcheck.interval_s,
            retries: service.config.healthcheck.retries,
          }
        : undefined,
    });

    await this.db.updateTable('services').set({ current_state: 'creating' }).where('id', '=', service.id).execute();
    const created = await this.docker.createContainer(options);
    await this.docker.getContainer(created.id).start();
    await this.db
      .insertInto('containers')
      .values({
        deployment_id: deployment.id,
        host_id: this.hostId,
        docker_id: created.id,
        name: options.name ?? null,
        state: 'starting',
      })
      .execute();
    await this.db
      .updateTable('services')
      .set({ current_state: 'starting' })
      .where('id', '=', service.id)
      .execute();
    await this.db
      .updateTable('deployments')
      .set({ status: 'active' })
      .where('id', '=', deployment.id)
      .execute();
  }

  private async removeContainer(dockerId: string): Promise<void> {
    const c = this.docker.getContainer(dockerId);
    try { await c.stop({ t: 30 }); } catch { /* may already be stopped */ }
    try { await c.remove({ force: true }); } catch { /* may already be removed */ }
    await this.db.deleteFrom('containers').where('docker_id', '=', dockerId).execute();
  }
}

export interface DriftReport {
  orphanContainers: ManagedContainerInfo[];    // in Docker, not in DB
  orphanRecords: Array<{ id: string; docker_id: string }>; // in DB, not in Docker
}

export async function computeDrift(db: HotboxDb, docker: Dockerode): Promise<DriftReport> {
  const observed = await listManagedContainers(docker);
  const observedIds = new Set(observed.map((c) => c.id));
  const records = await db.selectFrom('containers').select(['id', 'docker_id']).execute();
  const recordIds = new Set(records.map((r) => r.docker_id));

  return {
    orphanContainers: observed.filter((c) => !recordIds.has(c.id)),
    orphanRecords: records.filter((r) => !observedIds.has(r.docker_id)),
  };
}
