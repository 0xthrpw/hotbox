import Dockerode from 'dockerode';
import { PassThrough, type Readable, type Writable } from 'node:stream';
import { managedFilter, LABEL_DEPLOYMENT_ID, LABEL_SERVICE_ID } from '@hotbox/shared/labels';

export const API_VERSION = 'v1.45';

export interface DockerClientOptions {
  socketPath?: string;
  host?: string;
  port?: number;
}

export function createDockerClient(opts: DockerClientOptions = {}): Dockerode {
  if (opts.host) {
    return new Dockerode({ host: opts.host, port: opts.port ?? 2375, version: API_VERSION });
  }
  return new Dockerode({
    socketPath: opts.socketPath ?? '/var/run/docker.sock',
    version: API_VERSION,
  });
}

export interface ManagedContainerInfo {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  serviceId?: string;
  deploymentId?: string;
  labels: Record<string, string>;
}

export async function listManagedContainers(docker: Dockerode): Promise<ManagedContainerInfo[]> {
  const containers = await docker.listContainers({
    all: true,
    filters: JSON.stringify(managedFilter()),
  });
  return containers.map((c) => ({
    id: c.Id,
    name: c.Names[0]?.replace(/^\//, '') ?? '',
    image: c.Image,
    state: c.State,
    status: c.Status,
    serviceId: c.Labels[LABEL_SERVICE_ID],
    deploymentId: c.Labels[LABEL_DEPLOYMENT_ID],
    labels: c.Labels,
  }));
}

/**
 * Pull an image and resolve its digest. Returns the canonical digest
 * (e.g. `sha256:…`) so the caller can pin future deploys to it.
 */
export async function pullAndResolveDigest(
  docker: Dockerode,
  image: string,
  authconfig?: Dockerode.AuthConfig,
): Promise<string> {
  const stream = await docker.pull(image, authconfig ? { authconfig } : {});
  await new Promise<void>((resolve, reject) => {
    docker.modem.followProgress(stream, (err) => (err ? reject(err) : resolve()));
  });
  const info = await docker.getImage(image).inspect();
  // RepoDigests entries look like: 'erigontech/erigon@sha256:abc…'
  const repoDigest = info.RepoDigests?.[0];
  if (repoDigest && repoDigest.includes('@')) {
    return repoDigest.split('@')[1]!;
  }
  return info.Id;
}

export interface LogStreamOptions {
  since?: number;     // unix seconds
  tail?: number;
  stdout?: boolean;
  stderr?: boolean;
}

export interface LogChunk {
  stream: 'stdout' | 'stderr';
  data: Buffer;
}

/**
 * Stream multiplexed logs from a container, demultiplexed into stdout/stderr
 * frames. Yields chunks as they arrive; ends when the underlying stream ends.
 *
 * If the container has a TTY, Docker returns a non-multiplexed stream; in that
 * case everything is reported as stdout.
 */
export async function* streamLogs(
  docker: Dockerode,
  containerId: string,
  opts: LogStreamOptions = {},
): AsyncGenerator<LogChunk> {
  const container = docker.getContainer(containerId);
  const inspect = await container.inspect();
  const hasTty = inspect.Config.Tty;

  const stream = (await container.logs({
    follow: true,
    stdout: opts.stdout ?? true,
    stderr: opts.stderr ?? true,
    timestamps: false,
    tail: opts.tail ?? 200,
    since: opts.since,
  })) as unknown as Readable;

  if (hasTty) {
    for await (const chunk of stream) {
      yield { stream: 'stdout', data: chunk as Buffer };
    }
    return;
  }

  const stdout = new PassThrough();
  const stderr = new PassThrough();
  docker.modem.demuxStream(stream, stdout as unknown as Writable, stderr as unknown as Writable);

  const queue: LogChunk[] = [];
  let resolveWait: (() => void) | null = null;
  let ended = false;

  const wake = () => {
    if (resolveWait) {
      resolveWait();
      resolveWait = null;
    }
  };
  stdout.on('data', (d: Buffer) => { queue.push({ stream: 'stdout', data: d }); wake(); });
  stderr.on('data', (d: Buffer) => { queue.push({ stream: 'stderr', data: d }); wake(); });
  stream.on('end', () => { ended = true; wake(); });
  stream.on('error', () => { ended = true; wake(); });

  while (true) {
    if (queue.length > 0) {
      yield queue.shift()!;
      continue;
    }
    if (ended) return;
    await new Promise<void>((r) => { resolveWait = r; });
  }
}

export interface DockerEvent {
  Type?: string;
  Action?: string;
  Actor?: { ID: string; Attributes: Record<string, string> };
  time?: number;
  timeNano?: number;
}

/**
 * Long-running event tail with automatic reconnect. Survives engine restarts
 * by passing the last-seen timestamp back as `since=` on reconnect, so events
 * during the disconnect window are replayed (with possible duplicates the
 * consumer must handle idempotently).
 */
export async function* tailEvents(
  docker: Dockerode,
  opts: { abort?: AbortSignal } = {},
): AsyncGenerator<DockerEvent> {
  let since = Math.floor(Date.now() / 1000);

  while (!opts.abort?.aborted) {
    try {
      const stream = (await docker.getEvents({
        since,
        filters: JSON.stringify(managedFilter()),
      })) as unknown as Readable;

      const queue: DockerEvent[] = [];
      let resolveWait: (() => void) | null = null;
      let ended = false;
      const wake = () => { if (resolveWait) { resolveWait(); resolveWait = null; } };

      let buf = Buffer.alloc(0);
      stream.on('data', (chunk: Buffer) => {
        buf = Buffer.concat([buf, chunk]);
        let nl: number;
        while ((nl = buf.indexOf(0x0a)) >= 0) {
          const line = buf.subarray(0, nl).toString('utf8');
          buf = buf.subarray(nl + 1);
          if (!line.trim()) continue;
          try {
            const ev = JSON.parse(line) as DockerEvent;
            if (typeof ev.time === 'number') since = ev.time;
            queue.push(ev);
          } catch {
            // ignore malformed lines
          }
        }
        wake();
      });
      stream.on('end', () => { ended = true; wake(); });
      stream.on('error', () => { ended = true; wake(); });

      opts.abort?.addEventListener('abort', () => {
        stream.destroy();
        ended = true;
        wake();
      });

      while (!ended) {
        if (queue.length > 0) {
          yield queue.shift()!;
          continue;
        }
        await new Promise<void>((r) => { resolveWait = r; });
      }
    } catch {
      // fall through to reconnect
    }
    if (opts.abort?.aborted) return;
    await new Promise((r) => setTimeout(r, 2000));
  }
}
