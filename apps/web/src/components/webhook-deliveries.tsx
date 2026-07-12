'use client';

import useSWR from 'swr';
import type { WebhookDelivery } from '@/lib/types';

const fetcher = (url: string) => fetch(url, { credentials: 'include' }).then((r) => r.json());

function actionClass(d: WebhookDelivery): string {
  if (d.action === 'build') return 'text-(--color-healthy)';
  if (d.action === 'rejected') return 'text-(--color-error)';
  return 'text-(--color-muted)';
}

/**
 * Recent GitHub deliveries for this service's source and what hotbox decided
 * — including the ignores, which are the ones people come here to debug.
 */
export function WebhookDeliveries({ serviceId }: { serviceId: string }) {
  const { data } = useSWR<{ deliveries: WebhookDelivery[] }>(
    `/api/services/${serviceId}/webhook-deliveries`,
    fetcher,
    { refreshInterval: 15_000 },
  );
  const deliveries = data?.deliveries ?? [];

  if (deliveries.length === 0) {
    return (
      <p className="text-xs text-(--color-muted) italic">
        No webhook deliveries received yet. Ignored and rejected deliveries show up here too —
        if a push didn&apos;t build, this is where the reason lands.
      </p>
    );
  }

  return (
    <div className="border border-(--color-border) rounded overflow-hidden">
      <table className="w-full text-xs mono">
        <thead className="bg-(--color-surface) text-(--color-muted)">
          <tr>
            <th className="text-left px-3 py-2">at</th>
            <th className="text-left px-3 py-2">via</th>
            <th className="text-left px-3 py-2">event</th>
            <th className="text-left px-3 py-2">ref</th>
            <th className="text-left px-3 py-2">commit</th>
            <th className="text-left px-3 py-2">decision</th>
          </tr>
        </thead>
        <tbody>
          {deliveries.map((d) => (
            <tr key={d.id} className="border-t border-(--color-border)">
              <td className="px-3 py-2 text-(--color-muted)">
                {new Date(d.created_at).toLocaleString()}
              </td>
              <td className="px-3 py-2 text-(--color-muted)">{d.via}</td>
              <td className="px-3 py-2">{d.event}</td>
              <td className="px-3 py-2 text-(--color-muted)">
                {d.ref?.replace('refs/heads/', '') ?? '—'}
              </td>
              <td className="px-3 py-2 text-(--color-muted)">{d.head_sha?.slice(0, 7) ?? '—'}</td>
              <td className={`px-3 py-2 ${actionClass(d)}`}>
                {d.action === 'build' ? 'build queued' : d.action}
                {d.reason && d.action !== 'build' && (
                  <span className="text-(--color-muted)"> · {d.reason}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
