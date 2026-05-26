import { sql } from 'kysely';
import type { HotboxDb } from '@hotbox/db';

const TICK_MS = 24 * 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 60_000;

const NODE_METRICS_DAYS = 30;
const RPC_REQUESTS_DAYS = 90;

/**
 * Drops raw rows that have aged out of their retention window. We don't
 * downsample — the aggregator already produces hourly rpc_method_stats that
 * we keep indefinitely, and node_metrics older than 30 days haven't proven
 * useful enough to justify keeping in a downsampled form (yet).
 *
 * Postgres autovacuum will reclaim space asynchronously after the deletes.
 */
export async function runRetention(db: HotboxDb): Promise<void> {
  await sql`delete from node_metrics where time < now() - (${NODE_METRICS_DAYS} || ' days')::interval`.execute(db);
  await sql`delete from rpc_requests where time < now() - (${RPC_REQUESTS_DAYS} || ' days')::interval`.execute(db);
}

export class RetentionJob {
  private timer: NodeJS.Timeout | null = null;
  private bootTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: HotboxDb,
    private readonly logger: { info: (m: string, meta?: unknown) => void; error: (m: string, meta?: unknown) => void },
  ) {}

  start(): void {
    if (this.timer) return;
    const fire = () => {
      const t0 = Date.now();
      runRetention(this.db)
        .then(() => this.logger.info(`retention tick done in ${Date.now() - t0}ms`))
        .catch((err) => this.logger.error('retention failed', err));
    };
    this.timer = setInterval(fire, TICK_MS);
    this.bootTimer = setTimeout(fire, FIRST_RUN_DELAY_MS);
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.bootTimer) { clearTimeout(this.bootTimer); this.bootTimer = null; }
  }
}
