import type { HotboxDb } from '@hotbox/db';

interface CacheEntry {
  upstream: string;
  expiresAt: number;
}

const TTL_MS = 60_000;

/**
 * Resolve the upstream URL for a given service_id. Today the only template
 * that routes through rpc-proxy is `eth-archive`, which always forwards to
 * `<slug>-erigon:8545` on the shared `hotbox-public` network.
 *
 * Generalising later means storing the (target_role, target_port) on the
 * service row or in a templates registry the proxy can read.
 */
export class UpstreamRouter {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly db: HotboxDb) {}

  async resolve(serviceId: string): Promise<string | null> {
    const hit = this.cache.get(serviceId);
    if (hit && hit.expiresAt > Date.now()) return hit.upstream;

    const svc = await this.db
      .selectFrom('services')
      .select(['slug', 'template'])
      .where('id', '=', serviceId)
      .executeTakeFirst();
    if (!svc) return null;

    let upstream: string;
    if (svc.template === 'eth-archive') {
      upstream = `http://${svc.slug}-erigon:8545`;
    } else {
      return null;
    }

    this.cache.set(serviceId, { upstream, expiresAt: Date.now() + TTL_MS });
    return upstream;
  }

  invalidate(serviceId: string): void {
    this.cache.delete(serviceId);
  }
}
