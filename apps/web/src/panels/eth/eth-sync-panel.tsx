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

// Erigon v3 stages, as reported by the `sync{stage="…"}` gauge (value = block
// height reached by that stage). Key = the metric's stage label; label = display.
const STAGES: Array<{ key: string; label: string }> = [
  { key: 'otter_sync', label: 'OtterSync' },
  { key: 'headers', label: 'Headers' },
  { key: 'block_hashes', label: 'BlockHashes' },
  { key: 'bodies', label: 'Bodies' },
  { key: 'senders', label: 'Senders' },
  { key: 'execution', label: 'Execution' },
  { key: 'custom_trace', label: 'CustomTrace' },
  { key: 'tx_lookup', label: 'TxLookup' },
  { key: 'finish', label: 'Finish' },
];

export function EthSyncPanel({ serviceId }: PanelProps) {
  const { data } = useSWR<{ metrics: MetricRow[] }>(
    `/api/services/${serviceId}/metrics/latest`,
    fetcher,
    { refreshInterval: 5000 },
  );

  const metrics = data?.metrics ?? [];

  // `sync{stage=…}` reports the block height each stage has reached.
  const stageBlocks = STAGES.map(({ key, label }) => {
    const sample = metrics.find(
      (m) => m.source === 'erigon' && m.metric === 'sync' && m.labels.stage === key,
    );
    return { label, block: sample ? sample.value : null };
  });
  // Head block = the furthest any stage has reached; per-stage bar is relative to it.
  const head = Math.max(0, ...stageBlocks.map((s) => s.block ?? 0));

  const elPeers = num(metrics, 'erigon', 'p2p_peers');
  // Caplin (Erigon's embedded consensus client) exposes its head slot as `current_slot`.
  const clHead = num(metrics, 'erigon', 'current_slot');

  return (
    <div className="border border-(--color-border) rounded p-4 bg-(--color-surface)">
      <h3 className="text-xs uppercase tracking-wide text-(--color-muted) mb-3">Sync</h3>
      <div className="grid grid-cols-2 gap-6">
        <div>
          <div className="text-(--color-muted) text-xs mb-1">EXECUTION (erigon)</div>
          <div className="mono text-sm">head <span className="text-(--color-text)">#{fmt(head > 0 ? head : null)}</span></div>
          <div className="mono text-sm">peers <span className="text-(--color-text)">{fmt(elPeers)}</span></div>
        </div>
        <div>
          <div className="text-(--color-muted) text-xs mb-1">CONSENSUS (caplin)</div>
          <div className="mono text-sm">head slot <span className="text-(--color-text)">{fmt(clHead)}</span></div>
        </div>
      </div>

      <div className="mt-5">
        <div className="text-(--color-muted) text-xs mb-2">SYNC STAGES</div>
        <div className="space-y-1">
          {stageBlocks.map((s) => {
            const pct = head > 0 && s.block !== null ? (s.block / head) * 100 : 0;
            return (
              <div key={s.label} className="flex items-center gap-3 mono text-xs">
                <span className="w-44 truncate">{s.label}</span>
                <div className="flex-1 h-1.5 bg-(--color-surface-2) rounded overflow-hidden">
                  <div
                    className="h-full bg-(--color-healthy)"
                    style={{ width: `${Math.max(0, Math.min(100, pct)).toFixed(1)}%` }}
                  />
                </div>
                <span className="w-24 text-right text-(--color-muted)">
                  {s.block !== null ? `#${Math.round(s.block).toLocaleString()}` : '—'}
                </span>
              </div>
            );
          })}
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
