import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from 'kysely';
import { requireAuth } from './auth.js';

/**
 * Token/app usage analytics, served entirely from the hourly rpc_method_stats
 * rollups (the aggregator recomputes the last 3h every 5 min, including the
 * current partial hour, so worst-case staleness is one tick — no need to touch
 * raw rpc_requests, which would also flip latency semantics mid-range).
 *
 * Percentiles cannot be exactly re-aggregated across hourly buckets, so over a
 * window we report:
 *   p50_ms — count-weighted mean of hourly p50s ("typical" latency, ~p50)
 *   p99_ms — max of hourly p99s (worst observed hourly p99)
 * The UI labels these ~p50 / max p99.
 */

const QuerySchema = z.object({
  token_id: z.string().uuid().optional(),
  // Rollups are retained indefinitely; cap requests at 90 days.
  hours: z.coerce.number().int().positive().max(2160).default(24),
});

interface AggRow {
  count: string | number;
  error_count: string | number;
  p50_ms: string | number;
  p99_ms: string | number;
}

// pg returns sum(bigint) as strings — normalize once here, not in the UI.
function num(v: string | number | null | undefined): number {
  return v == null ? 0 : Number(v);
}

export async function rpcAnalyticsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/rpc-analytics/summary', async (req, reply) => {
    requireAuth(req);
    const { token_id: tokenId, hours } = QuerySchema.parse(req.query);
    const since = new Date(Date.now() - hours * 3600 * 1000);
    const tokenFilter = tokenId ? sql`and token_id = ${tokenId}` : sql``;

    const methodsQ = sql<AggRow & { method: string }>`
      select
        method,
        sum(count)::bigint as count,
        sum(error_count)::bigint as error_count,
        coalesce((sum(p50_ms::numeric * count) / nullif(sum(count), 0))::int, 0) as p50_ms,
        coalesce(max(p99_ms), 0) as p99_ms
      from rpc_method_stats
      where hour >= ${since} ${tokenFilter}
      group by method
      order by sum(count) desc
      limit 25
    `.execute(fastify.ctx.db);

    const totalsQ = sql<AggRow>`
      select
        coalesce(sum(count), 0)::bigint as count,
        coalesce(sum(error_count), 0)::bigint as error_count,
        coalesce((sum(p50_ms::numeric * count) / nullif(sum(count), 0))::int, 0) as p50_ms,
        coalesce(max(p99_ms), 0) as p99_ms
      from rpc_method_stats
      where hour >= ${since} ${tokenFilter}
    `.execute(fastify.ctx.db);

    // Per-token comparison only makes sense in the global (unfiltered) view.
    // NULL token_id = unauthenticated or hard-deleted token ("unattributed").
    const tokensQ = tokenId
      ? Promise.resolve(null)
      : sql<AggRow & { token_id: string | null; name: string | null; prefix: string | null; revoked_at: Date | null }>`
          select
            s.token_id, t.name, t.prefix, t.revoked_at,
            sum(s.count)::bigint as count,
            sum(s.error_count)::bigint as error_count,
            coalesce((sum(s.p50_ms::numeric * s.count) / nullif(sum(s.count), 0))::int, 0) as p50_ms,
            coalesce(max(s.p99_ms), 0) as p99_ms
          from rpc_method_stats s
          left join tokens t on t.id = s.token_id
          where s.hour >= ${since}
          group by s.token_id, t.name, t.prefix, t.revoked_at
          order by sum(s.count) desc
        `.execute(fastify.ctx.db);

    const [methods, totals, tokens] = await Promise.all([methodsQ, totalsQ, tokensQ]);
    const totalRow = totals.rows[0];

    return reply.send({
      window: { hours, since: since.toISOString() },
      totals: {
        count: num(totalRow?.count),
        error_count: num(totalRow?.error_count),
        p50_ms: num(totalRow?.p50_ms),
        p99_ms: num(totalRow?.p99_ms),
      },
      methods: methods.rows.map((r) => ({
        method: r.method,
        count: num(r.count),
        error_count: num(r.error_count),
        p50_ms: num(r.p50_ms),
        p99_ms: num(r.p99_ms),
      })),
      tokens: (tokens?.rows ?? []).map((r) => ({
        token_id: r.token_id,
        name: r.name,
        prefix: r.prefix,
        revoked_at: r.revoked_at,
        count: num(r.count),
        error_count: num(r.error_count),
        p50_ms: num(r.p50_ms),
        p99_ms: num(r.p99_ms),
      })),
    });
  });

  fastify.get('/rpc-analytics/timeseries', async (req, reply) => {
    requireAuth(req);
    const { token_id: tokenId, hours } = QuerySchema.parse(req.query);
    const since = new Date(Date.now() - hours * 3600 * 1000);
    const tokenFilter = tokenId ? sql`and token_id = ${tokenId}` : sql``;

    // Daily buckets past 7 days keep payloads small (30d → 30 points, not 720).
    // The unit is derived from this whitelist ternary — never from user input —
    // because date_trunc/interval units can't be bind parameters.
    const bucket = hours > 168 ? 'day' : 'hour';
    const unit = sql.raw(`'${bucket}'`);
    const step = sql.raw(`interval '1 ${bucket}'`);

    // Zero-fill gaps server-side so the chart gets one point per bucket.
    // Buckets truncate in UTC (date_trunc default).
    const result = await sql<{ t: Date } & AggRow>`
      with buckets as (
        select generate_series(
          date_trunc(${unit}, ${since}::timestamptz),
          date_trunc(${unit}, now()),
          ${step}
        ) as t
      ),
      agg as (
        select
          date_trunc(${unit}, hour) as t,
          sum(count)::bigint as count,
          sum(error_count)::bigint as error_count,
          coalesce((sum(p50_ms::numeric * count) / nullif(sum(count), 0))::int, 0) as p50_ms,
          coalesce(max(p99_ms), 0) as p99_ms
        from rpc_method_stats
        where hour >= ${since} ${tokenFilter}
        group by 1
      )
      select
        b.t,
        coalesce(a.count, 0) as count,
        coalesce(a.error_count, 0) as error_count,
        coalesce(a.p50_ms, 0) as p50_ms,
        coalesce(a.p99_ms, 0) as p99_ms
      from buckets b
      left join agg a using (t)
      order by b.t
    `.execute(fastify.ctx.db);

    return reply.send({
      bucket,
      points: result.rows.map((r) => ({
        t: r.t,
        count: num(r.count),
        error_count: num(r.error_count),
        p50_ms: num(r.p50_ms),
        p99_ms: num(r.p99_ms),
      })),
    });
  });
}
