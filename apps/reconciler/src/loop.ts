import type Dockerode from 'dockerode';
import type { HotboxDb, Service, Deployment } from '@hotbox/db';
import {
  listManagedContainers,
  buildContainerCreateOptions,
  tailEvents,
  type ManagedContainerInfo,
} from '@hotbox/docker';
import { labelsFor, LABEL_DEPLOYMENT_ID, LABEL_VERSION, LABEL_ROLE } from '@hotbox/shared';
import { traefikLabelsFor } from './traefik-labels.js';
import {
  planRoles,
  ensureTemplateInfra,
  ensureRoleDigest,
  buildOptionsForRole,
  type RolePlan,
} from './template-runner.js';

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
    if (service.desired_state === 'stopped' || service.desired_state === 'archived') {
      for (const c of observed) await this.removeContainer(c.id);
      await this.db.updateTable('services').set({ current_state: 'stopped' }).where('id', '=', service.id).execute();
      return;
    }

    const deployment = await this.db
      .selectFrom('deployments')
      .selectAll()
      .where('service_id', '=', service.id)
      .where('status', 'in', ['pending', 'active'])
      .orderBy('version', 'desc')
      .executeTakeFirst();

    if (!deployment) {
      await this.db.updateTable('services').set({ current_state: 'pending' }).where('id', '=', service.id).execute();
      return;
    }

    // Materialise networks, volumes, and bootstrap files (template only — no-op otherwise).
    await ensureTemplateInfra(this.docker, service);

    const plan = await planRoles(service, deployment);
    await this.applyPlan(service, deployment, plan, observed);
  }

  private async applyPlan(
    service: Service,
    deployment: Deployment,
    plan: RolePlan[],
    observed: ManagedContainerInfo[],
  ): Promise<void> {
    // Group observed by role
    const byRole = new Map<string, ManagedContainerInfo[]>();
    for (const c of observed) {
      const role = c.labels[LABEL_ROLE] ?? 'primary';
      const arr = byRole.get(role) ?? [];
      arr.push(c);
      byRole.set(role, arr);
    }

    const planRoleNames = new Set(plan.map((p) => p.role));

    // Remove roles that aren't in the plan any more (e.g., template was changed).
    for (const [role, list] of byRole) {
      if (!planRoleNames.has(role)) {
        for (const c of list) await this.removeContainer(c.id);
      }
    }

    let anyStarted = false;
    for (const item of plan) {
      const obs = byRole.get(item.role) ?? [];
      const matching = obs.filter(
        (c) =>
          c.labels[LABEL_DEPLOYMENT_ID] === deployment.id &&
          c.labels[LABEL_VERSION] === String(deployment.version),
      );
      const stale = obs.filter((c) => !matching.includes(c));

      const replaceFirst = service.config.replace_strategy === 'stop_then_start';
      if (replaceFirst) for (const c of stale) await this.removeContainer(c.id);

      if (matching.length === 0) {
        await this.startRole(service, deployment, item);
        anyStarted = true;
      }

      if (!replaceFirst) for (const c of stale) await this.removeContainer(c.id);
    }

    if (anyStarted) {
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
  }

  private async startRole(service: Service, deployment: Deployment, item: RolePlan): Promise<void> {
    const digest = await ensureRoleDigest(this.db, this.docker, deployment, item.role, item.image);

    const baseLabels: Record<string, string> = {
      ...labelsFor({
        serviceId: service.id,
        serviceSlug: service.slug,
        deploymentId: deployment.id,
        version: deployment.version,
        role: item.role,
      }),
      ...traefikLabelsFor({ service, container: item.container }),
    };

    const buildInput = buildOptionsForRole({
      service,
      deployment,
      role: item.role,
      container: item.container,
      digest,
      baseLabels,
      version: deployment.version,
    });

    const options = buildContainerCreateOptions(buildInput);

    await this.db
      .updateTable('services')
      .set({ current_state: 'creating' })
      .where('id', '=', service.id)
      .execute();

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
  }

  private async removeContainer(dockerId: string): Promise<void> {
    const c = this.docker.getContainer(dockerId);
    try { await c.stop({ t: 30 }); } catch { /* may already be stopped */ }
    try { await c.remove({ force: true }); } catch { /* may already be removed */ }
    await this.db.deleteFrom('containers').where('docker_id', '=', dockerId).execute();
  }
}

export interface DriftReport {
  orphanContainers: ManagedContainerInfo[];
  orphanRecords: Array<{ id: string; docker_id: string }>;
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
