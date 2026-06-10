'use client';

import { useState } from 'react';

export interface ChartSeries {
  label: string;
  /** One value per bucket, aligned with `labels`. */
  values: number[];
  /** Any CSS color, e.g. 'var(--color-accent)'. */
  color: string;
  kind: 'bar' | 'line';
}

interface TimeSeriesChartProps {
  /** Pre-formatted bucket labels ("14:00", "Jun 9"), one per bucket. */
  labels: string[];
  series: ChartSeries[];
  height?: number;
  formatValue?: (v: number) => string;
}

const VIEW_W = 1000;

function defaultFormat(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return Math.round(v).toLocaleString();
}

/**
 * Minimal SVG time-series chart (no chart library, per repo convention).
 * Bar series drawn in order share the same slot, so a smaller series (e.g.
 * errors) overlays the bottom of a larger one. Axis labels are HTML so the
 * stretched viewBox never distorts text.
 */
export function TimeSeriesChart({ labels, series, height = 160, formatValue = defaultFormat }: TimeSeriesChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const n = labels.length;

  if (n === 0 || series.length === 0) {
    return <div className="text-(--color-muted) text-sm py-8 text-center">No data.</div>;
  }

  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const yOf = (v: number) => height - (v / max) * height;
  const slot = VIEW_W / n;
  const barW = slot * 0.7;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const idx = Math.floor(((e.clientX - rect.left) / rect.width) * n);
    setHover(Math.max(0, Math.min(n - 1, idx)));
  };

  return (
    <div>
      <div className="flex gap-2">
        <div className="relative w-12 shrink-0 text-right text-[10px] text-(--color-muted) mono" style={{ height }}>
          <span className="absolute right-0 top-0">{formatValue(max)}</span>
          <span className="absolute right-0 top-1/2 -translate-y-1/2">{formatValue(max / 2)}</span>
          <span className="absolute right-0 bottom-0">0</span>
        </div>
        <div className="relative flex-1 min-w-0">
          <svg
            viewBox={`0 0 ${VIEW_W} ${height}`}
            preserveAspectRatio="none"
            className="block w-full"
            style={{ height }}
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
          >
            {[0, 0.5, 1].map((f) => (
              <line
                key={f}
                x1={0}
                x2={VIEW_W}
                y1={height * f}
                y2={height * f}
                stroke="var(--color-border)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {hover != null && (
              <line
                x1={(hover + 0.5) * slot}
                x2={(hover + 0.5) * slot}
                y1={0}
                y2={height}
                stroke="var(--color-muted)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            )}
            {series.filter((s) => s.kind === 'bar').map((s) => (
              <g key={s.label} fill={s.color}>
                {s.values.map((v, i) =>
                  v > 0 ? (
                    <rect
                      key={i}
                      x={i * slot + (slot - barW) / 2}
                      y={yOf(v)}
                      width={barW}
                      height={height - yOf(v)}
                      opacity={i === hover ? 1 : 0.85}
                    />
                  ) : null,
                )}
              </g>
            ))}
            {series.filter((s) => s.kind === 'line').map((s) => (
              <polyline
                key={s.label}
                points={s.values.map((v, i) => `${((i + 0.5) * slot).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ')}
                fill="none"
                stroke={s.color}
                strokeWidth={1.5}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
          {hover != null && (
            <div
              className="absolute top-0 z-10 pointer-events-none border border-(--color-border) rounded bg-(--color-surface-2) px-2 py-1 text-[11px] mono whitespace-nowrap"
              style={hover < n / 2 ? { left: `${((hover + 1) / n) * 100}%` } : { right: `${((n - hover) / n) * 100}%` }}
            >
              <div className="text-(--color-muted)">{labels[hover]}</div>
              {series.map((s) => (
                <div key={s.label}>
                  <span style={{ color: s.color }}>●</span> {s.label}: {formatValue(s.values[hover] ?? 0)}
                </div>
              ))}
            </div>
          )}
          <div className="grid grid-cols-3 text-[10px] text-(--color-muted) mono mt-1">
            <span>{labels[0]}</span>
            <span className="text-center">{labels[Math.floor((n - 1) / 2)]}</span>
            <span className="text-right">{labels[n - 1]}</span>
          </div>
        </div>
      </div>
      <div className="flex gap-4 mt-2 ml-14 text-xs text-(--color-muted)">
        {series.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
