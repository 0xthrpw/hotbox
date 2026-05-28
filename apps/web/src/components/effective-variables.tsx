'use client';

import useSWR from 'swr';

interface EffectiveRow {
  key: string;
  value: string | null;            // null when origin row is_secret
  origin: 'project' | 'environment' | 'service';
  is_secret: boolean;
}

const fetcher = (url: string) => fetch(url, { credentials: 'include' }).then((r) => r.json());

const originStyle: Record<EffectiveRow['origin'], string> = {
  project: 'bg-(--color-surface-2) text-(--color-muted)',
  environment: 'bg-(--color-surface-2) text-(--color-text)',
  service: 'bg-(--color-accent)/15 text-(--color-accent)',
};

/**
 * Read-only merged view of variables that resolve onto a service. Shows
 * which scope is winning per key so operators can spot e.g. an
 * environment-scoped override of a project default.
 */
export function EffectiveVariables({ serviceId }: { serviceId: string }) {
  const { data, isLoading } = useSWR<{ variables: EffectiveRow[] }>(
    `/api/services/${serviceId}/variables/effective`,
    fetcher,
  );

  if (isLoading) return <div className="text-xs text-(--color-muted) italic">Loading…</div>;
  const rows = data?.variables ?? [];
  if (rows.length === 0) {
    return <div className="text-xs text-(--color-muted) italic">No effective variables.</div>;
  }

  return (
    <div className="border border-(--color-border) rounded overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-(--color-surface) text-(--color-muted)">
          <tr>
            <th className="text-left px-3 py-2 font-medium">Key</th>
            <th className="text-left px-3 py-2 font-medium">Value</th>
            <th className="text-left px-3 py-2 font-medium">From</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-t border-(--color-border)">
              <td className="px-3 py-2 mono text-xs">{row.key}</td>
              <td className="px-3 py-2 mono text-xs">
                {row.is_secret
                  ? <span className="text-(--color-muted)">••••••••</span>
                  : <span>{row.value}</span>}
              </td>
              <td className="px-3 py-2">
                <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${originStyle[row.origin]}`}>
                  {row.origin}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
