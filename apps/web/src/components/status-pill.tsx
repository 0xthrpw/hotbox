import clsx from 'clsx';
import type { CurrentState } from '@hotbox/shared';

const STATE_COLOR: Record<CurrentState, string> = {
  running: 'bg-(--color-healthy)',
  starting: 'bg-(--color-warn) pulse-dot',
  creating: 'bg-(--color-warn) pulse-dot',
  degraded: 'bg-(--color-warn)',
  failed: 'bg-(--color-error)',
  stopped: 'bg-transparent border border-(--color-stopped)',
  pending: 'bg-(--color-muted)',
};

const STATE_LABEL: Record<CurrentState, string> = {
  running: 'healthy',
  starting: 'starting',
  creating: 'creating',
  degraded: 'degraded',
  failed: 'failed',
  stopped: 'stopped',
  pending: 'pending',
};

export function StatusPill({ state, label }: { state: CurrentState; label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-(--color-muted)">
      <span className={clsx('w-2 h-2 rounded-full', STATE_COLOR[state])} />
      <span className="text-sm">{label ?? STATE_LABEL[state]}</span>
    </span>
  );
}
