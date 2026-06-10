import { sql } from 'kysely';
import type { HotboxDb } from '@hotbox/db';

const TICK_MS = 5 * 60 * 1000;
/** How many recent hours to recompute on each tick. Keeps late-arriving rows correct. */
const WINDOW_HOURS = 3;

/**
 * Recomputes hourly aggregates from rpc_requests into rpc_method_stats for the
 * last WINDOW_HOURS hours, *including* the current partial hour. Idempotent —
 * UPSERTs on the natural key, so the in-progress bucket is simply overwritten
 * with fuller counts on every tick and dashboards lag by at most TICK_MS.
 *
 * Why a window: the rpc-proxy buffers writes with a 1s flush, and clock skew
 * between containers can cause rows for hour H to arrive slightly after H+1
 * starts. Recomputing the last few hours catches those without much extra cost.
 */
export async function runAggregation(db: HotboxDb): Promise<void> {
  await sql`
    insert into rpc_method_stats (hour, service_id, token_id, method, count, error_count, p50_ms, p99_ms)
    select
      date_trunc('hour', time) as hour,
      service_id,
      token_id,
      method,
      count(*)::bigint as count,
      count(*) filter (where status >= 400)::bigint as error_count,
      coalesce(percentile_disc(0.5) within group (order by latency_ms), 0)::int as p50_ms,
      coalesce(percentile_disc(0.99) within group (order by latency_ms), 0)::int as p99_ms
    from rpc_requests
    where time >= date_trunc('hour', now()) - (${WINDOW_HOURS} || ' hours')::interval
    group by date_trunc('hour', time), service_id, token_id, method
    on conflict (hour, service_id, coalesce(token_id, '00000000-0000-0000-0000-000000000000'::uuid), method)
    do update set
      count = excluded.count,
      error_count = excluded.error_count,
      p50_ms = excluded.p50_ms,
      p99_ms = excluded.p99_ms
  `.execute(db);
}

export class Aggregator {
  private timer: NodeJS.Timeout | null = null;
  constructor(
    private readonly db: HotboxDb,
    private readonly logger: { info: (m: string, meta?: unknown) => void; error: (m: string, meta?: unknown) => void },
  ) {}

  start(): void {
    if (this.timer) return;
    // First run is delayed a few seconds to let the rest of boot finish.
    const fire = () => {
      runAggregation(this.db)
        .then(() => this.logger.info('rpc aggregation tick complete'))
        .catch((err) => this.logger.error('rpc aggregation failed', err));
    };
    this.timer = setInterval(fire, TICK_MS);
    setTimeout(fire, 30_000);
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }
}
