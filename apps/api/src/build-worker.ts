import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Dockerode from 'dockerode';
import type { HotboxDb, NetworkRef, SecretRef } from '@hotbox/db';
import type { KeyRing } from '@hotbox/crypto';
import type { Reconciler } from '@hotbox/reconciler';
import { buildImageFromDir, LOCAL_IMAGE_PREFIX } from '@hotbox/docker';
import { resolveVariables } from './lib/resolve-variables.js';

const execFileAsync = promisify(execFile);

const TICK_MS = 10_000;
/** Keep the captured build log bounded so a runaway build can't bloat the row. */
const LOG_CAP_BYTES = 256 * 1024;

interface Logger {
  info: (m: string, meta?: unknown) => void;
  error: (m: string, meta?: unknown) => void;
}

/**
 * Processes github-source builds one at a time: shallow-clone the public repo,
 * build the image on the host, create a deployment, and hand off to the
 * reconciler. Runs in-process alongside the reconciler/aggregator (the heavy
 * lifting happens in the Docker daemon and git subprocess, so it doesn't block
 * the event loop).
 *
 * Serial by design — a single concurrent build keeps host CPU/disk predictable.
 * Queue depth is visible in the builds table.
 */
export class BuildWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly db: HotboxDb,
    private readonly docker: Dockerode,
    private readonly keyring: KeyRing,
    private readonly reconciler: Reconciler,
    private readonly logger: Logger,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    void this.tick();
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  /** Trigger a tick immediately (e.g. right after enqueuing a build). */
  kick(): void {
    queueMicrotask(() => void this.tick());
  }

  private async tick(): Promise<void> {
    if (this.running) return;       // serial — one build at a time
    this.running = true;
    try {
      // Drain the queue: a kick after enqueue, or a tick, processes all
      // pending builds before yielding.
      for (;;) {
        const next = await this.db
          .selectFrom('builds')
          .selectAll()
          .where('status', '=', 'queued')
          .orderBy('created_at', 'asc')
          .limit(1)
          .executeTakeFirst();
        if (!next) return;
        await this.processBuild(next.id);
      }
    } catch (err) {
      this.logger.error('build worker tick failed', err);
    } finally {
      this.running = false;
    }
  }

  private async processBuild(buildId: string): Promise<void> {
    const build = await this.db
      .selectFrom('builds').selectAll().where('id', '=', buildId).executeTakeFirst();
    if (!build) return;

    const source = await this.db
      .selectFrom('github_sources').selectAll().where('id', '=', build.github_source_id).executeTakeFirst();
    const service = await this.db
      .selectFrom('services')
      .innerJoin('projects', 'projects.id', 'services.project_id')
      .innerJoin('environments', 'environments.id', 'services.environment_id')
      .select([
        'services.id', 'services.slug',
        'projects.slug as project_slug',
        'environments.slug as environment_slug',
      ])
      .where('services.id', '=', build.service_id)
      .executeTakeFirst();

    if (!source || !service) {
      await this.fail(buildId, 'build source or service no longer exists', '');
      return;
    }

    let workDir: string | null = null;
    let log = '';
    const appendLog = (chunk: string) => {
      log += chunk;
      if (log.length > LOG_CAP_BYTES) {
        log = `…(truncated)…\n${log.slice(log.length - LOG_CAP_BYTES)}`;
      }
    };

    try {
      await this.db.updateTable('builds')
        .set({ status: 'cloning', started_at: new Date() })
        .where('id', '=', buildId).execute();

      workDir = await mkdtemp(join(tmpdir(), 'hotbox-build-'));
      const repoUrl = `https://github.com/${source.repo_full_name}.git`;
      appendLog(`$ git clone --depth 1 --branch ${source.branch} ${repoUrl}\n`);
      await execFileAsync('git', [
        'clone', '--depth', '1', '--branch', source.branch, '--single-branch',
        repoUrl, workDir,
      ], { timeout: 120_000 });

      const sha = (await execFileAsync('git', ['-C', workDir, 'rev-parse', 'HEAD'])).stdout.trim();
      const message = (await execFileAsync('git', ['-C', workDir, 'log', '-1', '--format=%s'])).stdout.trim();
      const author = (await execFileAsync('git', ['-C', workDir, 'log', '-1', '--format=%an'])).stdout.trim();
      const shortSha = sha.slice(0, 12);
      appendLog(`Resolved ${shortSha} — ${message} (${author})\n`);

      await this.db.updateTable('builds')
        .set({ status: 'building', commit_sha: sha, commit_message: message, commit_author: author })
        .where('id', '=', buildId).execute();

      const tag = `${LOCAL_IMAGE_PREFIX}${service.project_slug}-${service.environment_slug}-${service.slug}:${shortSha}`;
      const contextDir = join(workDir, source.build_context);
      appendLog(`Building ${tag} (dockerfile=${source.dockerfile_path}, context=${source.build_context})\n`);

      const imageId = await buildImageFromDir(this.docker, {
        contextDir,
        dockerfile: source.dockerfile_path,
        tag,
        onLog: appendLog,
      });
      appendLog(`Built image ${imageId}\n`);

      await this.db.updateTable('builds')
        .set({ status: 'deploying', image_tag: tag, image_digest: imageId })
        .where('id', '=', buildId).execute();

      // New deployment carries the freshly-resolved variables. Wiring
      // (secret_refs/network_refs) is carried forward from the previous
      // deployment if any — github services have none in 4a, but this keeps
      // the path identical to a normal redeploy.
      const latest = await this.db
        .selectFrom('deployments')
        .select(['version', 'secret_refs', 'network_refs'])
        .where('service_id', '=', build.service_id)
        .orderBy('version', 'desc')
        .executeTakeFirst();
      const env = await resolveVariables(this.db, this.keyring, build.service_id);

      await this.db.insertInto('deployments').values({
        service_id: build.service_id,
        version: (latest?.version ?? 0) + 1,
        image: tag,
        image_digest: imageId,
        env_snapshot: env,
        secret_refs: (latest?.secret_refs as SecretRef[] | undefined) ?? [],
        network_refs: (latest?.network_refs as NetworkRef[] | undefined) ?? [],
        created_by: null,
      }).execute();

      await this.db.updateTable('builds')
        .set({ status: 'success', finished_at: new Date(), log })
        .where('id', '=', buildId).execute();
      await this.db.updateTable('github_sources')
        .set({ last_built_sha: sha })
        .where('id', '=', source.id).execute();

      this.reconciler.reconcileSoon(build.service_id);
      this.logger.info(`build ${shortSha} for ${service.slug} succeeded`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      appendLog(`\nBUILD FAILED: ${msg}\n`);
      await this.fail(buildId, msg, log);
      this.logger.error(`build ${buildId} failed`, err);
    } finally {
      if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  private async fail(buildId: string, errorMessage: string, log: string): Promise<void> {
    await this.db.updateTable('builds')
      .set({ status: 'failed', error_message: errorMessage, finished_at: new Date(), log })
      .where('id', '=', buildId)
      .execute();
  }
}
