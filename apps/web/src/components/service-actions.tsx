'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from './ui';
import type { DesiredState } from '@hotbox/shared';

export function ServiceActions({
  serviceId,
  desiredState,
}: {
  serviceId: string;
  desiredState: DesiredState;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function call(path: string, label: string, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(label);
    try {
      const res = await fetch(`/api/services/${serviceId}${path}`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({ error: `${label} failed` }));
        alert(payload.error ?? `${label} failed`);
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  if (desiredState === 'archived') {
    return <span className="text-xs text-(--color-muted)">archived</span>;
  }

  const stopped = desiredState === 'stopped';

  return (
    <div className="flex items-center gap-2">
      {stopped ? (
        <Button onClick={() => call('/start', 'start')} disabled={busy !== null}>
          {busy === 'start' ? 'Starting…' : 'Start'}
        </Button>
      ) : (
        <Button
          variant="secondary"
          onClick={() => call('/stop', 'stop')}
          disabled={busy !== null}
        >
          {busy === 'stop' ? 'Stopping…' : 'Stop'}
        </Button>
      )}
      <Button
        variant="secondary"
        onClick={() => call('/deployments', 'redeploy')}
        disabled={busy !== null || stopped}
        title={stopped ? 'Start the service first' : 'Pull latest image and recreate'}
      >
        {busy === 'redeploy' ? 'Redeploying…' : 'Redeploy'}
      </Button>
      <Button
        variant="danger"
        onClick={() =>
          call(
            '/archive',
            'archive',
            'Archive this service?\n\nContainers will be stopped. Data volumes are preserved.',
          )
        }
        disabled={busy !== null}
      >
        {busy === 'archive' ? 'Archiving…' : 'Archive'}
      </Button>
    </div>
  );
}
