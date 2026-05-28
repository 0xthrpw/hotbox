import type Dockerode from 'dockerode';
import tar from 'tar-fs';

/**
 * Prefix for images built on the host from a github source. The reconciler
 * keys off this to skip the registry pull (there's no registry — the image
 * exists locally, pinned by its unique :<sha> tag).
 */
export const LOCAL_IMAGE_PREFIX = 'hotbox-local/';

export function isLocalImage(image: string): boolean {
  return image.startsWith(LOCAL_IMAGE_PREFIX);
}

export interface BuildImageOptions {
  /** Directory to use as the Docker build context (already on disk). */
  contextDir: string;
  /** Dockerfile path relative to contextDir. */
  dockerfile: string;
  /** Image tag to apply, e.g. hotbox-local/proj-env-slug:abc1234. */
  tag: string;
  /** Called with each chunk of build output for log capture. */
  onLog?: (chunk: string) => void;
}

interface BuildProgressEvent {
  stream?: string;
  error?: string;
  errorDetail?: { message?: string };
  aux?: { ID?: string };
}

/**
 * Build an image from a local directory and return the resulting image ID.
 *
 * Docker reports build failures as an `error`/`errorDetail` entry in the
 * progress stream rather than as a thrown error, so we inspect both the
 * followProgress error arg and the collected output before resolving.
 */
export async function buildImageFromDir(
  docker: Dockerode,
  opts: BuildImageOptions,
): Promise<string> {
  const context = tar.pack(opts.contextDir);
  const buildStream = await docker.buildImage(context, {
    t: opts.tag,
    dockerfile: opts.dockerfile,
  });

  await new Promise<void>((resolve, reject) => {
    docker.modem.followProgress(
      buildStream,
      (err: Error | null, output?: BuildProgressEvent[]) => {
        if (err) return reject(err);
        const failed = output?.find((e) => e.error || e.errorDetail);
        if (failed) {
          return reject(new Error(failed.error ?? failed.errorDetail?.message ?? 'build failed'));
        }
        resolve();
      },
      (evt: BuildProgressEvent) => {
        if (!opts.onLog) return;
        if (typeof evt.stream === 'string' && evt.stream.length > 0) opts.onLog(evt.stream);
        else if (typeof evt.error === 'string') opts.onLog(evt.error);
      },
    );
  });

  const info = await docker.getImage(opts.tag).inspect();
  return info.Id;
}
