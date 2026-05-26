'use client';

import useSWR from 'swr';
import type { PanelProps } from '../registry';

interface TopMethod {
  method: string;
  count: number;
  error_count: number;
  p50_ms: number;
  p99_ms: number;
}

const fetcher = (url: string) => fetch(url, { credentials: 'include' }).then((r) => r.json());

export function EthRpcPanel({ serviceId }: PanelProps) {
  const { data } = useSWR<{ top_methods: TopMethod[] }>(
    `/api/services/${serviceId}/rpc-stats?hours=24`,
    fetcher,
    { refreshInterval: 30_000 },
  );

  const methods = data?.top_methods ?? [];
  const total = methods.reduce((s, m) => s + Number(m.count), 0) || 1;

  return (
    <div className="border border-(--color-border) rounded p-4 bg-(--color-surface)">
      <h3 className="text-xs uppercase tracking-wide text-(--color-muted) mb-3">RPC — last 24h</h3>
      {methods.length === 0 ? (
        <div className="text-(--color-muted) text-sm">No requests yet.</div>
      ) : (
        <table className="w-full text-xs mono">
          <thead className="text-(--color-muted)">
            <tr>
              <th className="text-left py-1">method</th>
              <th className="text-right py-1">share</th>
              <th className="text-right py-1">count</th>
              <th className="text-right py-1">err</th>
              <th className="text-right py-1">p50</th>
              <th className="text-right py-1">p99</th>
            </tr>
          </thead>
          <tbody>
            {methods.map((m) => (
              <tr key={m.method} className="border-t border-(--color-border)">
                <td className="py-1">{m.method}</td>
                <td className="py-1 text-right">{((Number(m.count) / total) * 100).toFixed(1)}%</td>
                <td className="py-1 text-right">{Number(m.count).toLocaleString()}</td>
                <td className="py-1 text-right text-(--color-error)">{Number(m.error_count).toLocaleString()}</td>
                <td className="py-1 text-right">{m.p50_ms}ms</td>
                <td className="py-1 text-right">{m.p99_ms}ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
