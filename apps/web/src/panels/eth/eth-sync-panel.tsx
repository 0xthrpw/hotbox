'use client';

import useSWR from 'swr';
import type { PanelProps } from '../registry';

interface MetricRow {
  source: string;
  metric: string;
  labels: Record<string, string>;
  value: number;
  time: string;
}

const fetcher = (url: string) => fetch(url, { credentials: 'include' }).then((r) => r.json());

const STAGES = [
  'Snapshots', 'Headers', 'BlockHashes', 'Bodies', 'Senders',
  'Execution', 'HashState', 'IntermediateHashes', 'CallTraces',
  'AccountHistoryIndex', 'StorageHistoryIndex', 'TxLookup',
];

export function EthSyncPanel({ serviceId }: PanelProps) {
  const { data } = useSWR<{ metrics: MetricRow[] }>(
    `/api/services/${serviceId}/metrics/latest`,
    fetcher,
    { refreshInterval: 5000 },
  );

  const metrics = data?.metrics ?? [];
  const stageProgress = STAGES.map((name) => {
    const sample = metrics.find(
      (m) => m.source === 'erigon' && m.metric === 'sync_stage_progress' && m.labels.stage === name,
    );
    return { name, value: sample?.value ?? null };
  });

  const head = num(metrics, 'erigon', 'chain_head_block');
  const elPeers = num(metrics, 'erigon', 'p2p_peers');
  const clHead = num(metrics, 'lighthouse', 'beacon_head_slot');
  const clPeers = num(metrics, 'lighthouse', 'libp2p_peers');

  return (
    <div className="border border-(--color-border) rounded p-4 bg-(--color-surface)">
      <h3 className="text-xs uppercase tracking-wide text-(--color-muted) mb-3">Sync</h3>
      <div className="grid grid-cols-2 gap-6">
        <div>
          <div className="text-(--color-muted) text-xs mb-1">EXECUTION (erigon)</div>
          <div className="mono text-sm">head <span className="text-(--color-text)">#{fmt(head)}</span></div>
          <div className="mono text-sm">peers <span className="text-(--color-text)">{fmt(elPeers)}</span></div>
        </div>
        <div>
          <div className="text-(--color-muted) text-xs mb-1">CONSENSUS (lighthouse)</div>
          <div className="mono text-sm">head slot <span className="text-(--color-text)">{fmt(clHead)}</span></div>
          <div className="mono text-sm">peers <span className="text-(--color-text)">{fmt(clPeers)}</span></div>
        </div>
      </div>

      <div className="mt-5">
        <div className="text-(--color-muted) text-xs mb-2">SYNC STAGES</div>
        <div className="space-y-1">
          {stageProgress.map((s) => (
            <div key={s.name} className="flex items-center gap-3 mono text-xs">
              <span className="w-44 truncate">{s.name}</span>
              <div className="flex-1 h-1.5 bg-(--color-surface-2) rounded overflow-hidden">
                <div
                  className="h-full bg-(--color-healthy)"
                  style={{ width: `${Math.max(0, Math.min(100, (s.value ?? 0) * 100)).toFixed(1)}%` }}
                />
              </div>
              <span className="w-12 text-right text-(--color-muted)">
                {s.value !== null ? `${(s.value * 100).toFixed(0)}%` : '—'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function num(rows: MetricRow[], source: string, metric: string): number | null {
  const sample = rows.find((m) => m.source === source && m.metric === metric);
  return sample ? sample.value : null;
}

function fmt(v: number | null): string {
  if (v === null) return '—';
  return Math.round(v).toLocaleString();
}
