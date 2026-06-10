'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Field, Select } from '@/components/ui';
import { TimeSeriesChart } from '@/components/time-series-chart';
import type { TokenRow } from '../tokens/tokens-client';

interface Stat {
  count: number;
  error_count: number;
  p50_ms: number;
  p99_ms: number;
}

export interface SummaryResponse {
  window: { hours: number; since: string };
  totals: Stat;
  methods: (Stat & { method: string })[];
  tokens: (Stat & {
    token_id: string | null;
    name: string | null;
    prefix: string | null;
    revoked_at: string | null;
  })[];
}

export interface TimeseriesResponse {
  bucket: 'hour' | 'day';
  points: (Stat & { t: string })[];
}

const RANGES = [
  { hours: 24, label: 'Last 24 hours' },
  { hours: 168, label: 'Last 7 days' },
  { hours: 720, label: 'Last 30 days' },
];

const P50_TITLE = 'Count-weighted mean of hourly p50s — approximate, from hourly rollups';
const P99_TITLE = 'Max hourly p99 in the window — approximate, from hourly rollups';

const fetcher = (url: string) => fetch(url, { credentials: 'include' }).then((r) => r.json());

function bucketLabel(t: string, bucket: 'hour' | 'day', hours: number): string {
  const d = new Date(t);
  if (bucket === 'day') return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  if (hours > 24) return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function AnalyticsClient({
  initialSummary,
  initialTimeseries,
  tokens,
}: {
  initialSummary: SummaryResponse;
  initialTimeseries: TimeseriesResponse;
  tokens: TokenRow[];
}) {
  const [tokenId, setTokenId] = useState('');
  const [hours, setHours] = useState(24);

  const params = `hours=${hours}${tokenId ? `&token_id=${tokenId}` : ''}`;
  const isDefault = hours === 24 && tokenId === '';

  const { data: summary } = useSWR<SummaryResponse>(`/api/rpc-analytics/summary?${params}`, fetcher, {
    refreshInterval: 30_000,
    keepPreviousData: true,
    fallbackData: isDefault ? initialSummary : undefined,
  });
  const { data: timeseries } = useSWR<TimeseriesResponse>(`/api/rpc-analytics/timeseries?${params}`, fetcher, {
    refreshInterval: 30_000,
    keepPreviousData: true,
    fallbackData: isDefault ? initialTimeseries : undefined,
  });

  const rpcTokens = tokens.filter((t) => t.kind === 'rpc');
  const totals = summary?.totals;
  const methods = summary?.methods ?? [];
  const methodSum = methods.reduce((s, m) => s + m.count, 0);
  const otherCount = totals ? totals.count - methodSum : 0;
  const points = timeseries?.points ?? [];
  const labels = points.map((p) => bucketLabel(p.t, timeseries?.bucket ?? 'hour', hours));
  const errorRate = totals && totals.count > 0 ? (totals.error_count / totals.count) * 100 : 0;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <h1 className="text-lg font-semibold">RPC analytics</h1>
        <div className="flex gap-3">
          <Field label="Token">
            <Select value={tokenId} onChange={(e) => setTokenId(e.target.value)} className="w-56">
              <option value="">All tokens</option>
              {rpcTokens.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}{t.revoked_at ? ' (revoked)' : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Range">
            <Select value={hours} onChange={(e) => setHours(Number(e.target.value))} className="w-40">
              {RANGES.map((r) => (
                <option key={r.hours} value={r.hours}>{r.label}</option>
              ))}
            </Select>
          </Field>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard label="Requests" value={(totals?.count ?? 0).toLocaleString()} />
        <StatCard
          label="Error rate"
          value={`${errorRate.toFixed(2)}%`}
          tone={errorRate > 1 ? 'error' : undefined}
        />
        <StatCard label="~p50" value={`${totals?.p50_ms ?? 0}ms`} title={P50_TITLE} />
        <StatCard label="max p99" value={`${totals?.p99_ms ?? 0}ms`} title={P99_TITLE} />
      </div>

      <div className="grid lg:grid-cols-2 gap-4 mb-6">
        <div className="border border-(--color-border) rounded p-4 bg-(--color-surface)">
          <h3 className="text-xs uppercase tracking-wide text-(--color-muted) mb-3">Requests</h3>
          <TimeSeriesChart
            labels={labels}
            series={[
              { label: 'requests', values: points.map((p) => p.count), color: 'var(--color-accent)', kind: 'bar' },
              { label: 'errors', values: points.map((p) => p.error_count), color: 'var(--color-error)', kind: 'bar' },
            ]}
          />
        </div>
        <div className="border border-(--color-border) rounded p-4 bg-(--color-surface)">
          <h3 className="text-xs uppercase tracking-wide text-(--color-muted) mb-3">Latency</h3>
          <TimeSeriesChart
            labels={labels}
            series={[
              { label: '~p50', values: points.map((p) => p.p50_ms), color: 'var(--color-healthy)', kind: 'line' },
              { label: 'max p99', values: points.map((p) => p.p99_ms), color: 'var(--color-warn)', kind: 'line' },
            ]}
            formatValue={(v) => `${Math.round(v)}ms`}
          />
        </div>
      </div>

      <div className="border border-(--color-border) rounded p-4 bg-(--color-surface) mb-6">
        <h3 className="text-xs uppercase tracking-wide text-(--color-muted) mb-3">Methods</h3>
        {methods.length === 0 ? (
          <div className="text-(--color-muted) text-sm">No requests in this window.</div>
        ) : (
          <table className="w-full text-xs mono">
            <thead className="text-(--color-muted)">
              <tr>
                <th className="text-left py-1">method</th>
                <th className="text-right py-1">share</th>
                <th className="text-right py-1">count</th>
                <th className="text-right py-1">err</th>
                <th className="text-right py-1" title={P50_TITLE}>~p50</th>
                <th className="text-right py-1" title={P99_TITLE}>max p99</th>
              </tr>
            </thead>
            <tbody>
              {methods.map((m) => (
                <tr key={m.method} className="border-t border-(--color-border)">
                  <td className="py-1">{m.method}</td>
                  <td className="py-1 text-right">{totals ? ((m.count / Math.max(1, totals.count)) * 100).toFixed(1) : '0.0'}%</td>
                  <td className="py-1 text-right">{m.count.toLocaleString()}</td>
                  <td className="py-1 text-right text-(--color-error)">{m.error_count.toLocaleString()}</td>
                  <td className="py-1 text-right">{m.p50_ms}ms</td>
                  <td className="py-1 text-right">{m.p99_ms}ms</td>
                </tr>
              ))}
              {otherCount > 0 && (
                <tr className="border-t border-(--color-border) text-(--color-muted)">
                  <td className="py-1">(other)</td>
                  <td className="py-1 text-right">{totals ? ((otherCount / Math.max(1, totals.count)) * 100).toFixed(1) : '0.0'}%</td>
                  <td className="py-1 text-right">{otherCount.toLocaleString()}</td>
                  <td className="py-1 text-right" colSpan={3} />
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {tokenId === '' && (
        <div className="border border-(--color-border) rounded p-4 bg-(--color-surface)">
          <h3 className="text-xs uppercase tracking-wide text-(--color-muted) mb-3">By token</h3>
          {(summary?.tokens ?? []).length === 0 ? (
            <div className="text-(--color-muted) text-sm">No requests in this window.</div>
          ) : (
            <table className="w-full text-xs mono">
              <thead className="text-(--color-muted)">
                <tr>
                  <th className="text-left py-1">token</th>
                  <th className="text-right py-1">count</th>
                  <th className="text-right py-1">err</th>
                  <th className="text-right py-1" title={P50_TITLE}>~p50</th>
                  <th className="text-right py-1" title={P99_TITLE}>max p99</th>
                </tr>
              </thead>
              <tbody>
                {(summary?.tokens ?? []).map((t) => (
                  <tr
                    key={t.token_id ?? 'null'}
                    className={`border-t border-(--color-border) ${t.token_id ? 'cursor-pointer hover:bg-(--color-surface-2)' : ''}`}
                    onClick={() => t.token_id && setTokenId(t.token_id)}
                  >
                    <td className="py-1">
                      {t.token_id === null ? (
                        <span
                          className="text-(--color-muted)"
                          title="Requests with no surviving token — unauthenticated, or the token was hard-deleted"
                        >
                          (unattributed)
                        </span>
                      ) : (
                        <>
                          {t.name ?? t.prefix}
                          {t.revoked_at && <span className="text-(--color-muted)"> (revoked)</span>}
                        </>
                      )}
                    </td>
                    <td className="py-1 text-right">{t.count.toLocaleString()}</td>
                    <td className="py-1 text-right text-(--color-error)">{t.error_count.toLocaleString()}</td>
                    <td className="py-1 text-right">{t.p50_ms}ms</td>
                    <td className="py-1 text-right">{t.p99_ms}ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </>
  );
}

function StatCard({ label, value, title, tone }: { label: string; value: string; title?: string; tone?: 'error' }) {
  return (
    <div className="border border-(--color-border) rounded p-4 bg-(--color-surface)" title={title}>
      <div className="text-xs uppercase tracking-wide text-(--color-muted) mb-1">{label}</div>
      <div className={`text-xl font-semibold mono ${tone === 'error' ? 'text-(--color-error)' : ''}`}>{value}</div>
    </div>
  );
}
