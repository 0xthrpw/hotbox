import { redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { TopNav } from '@/components/nav';

interface AuditEntry {
  id: number;
  action: string;
  target_kind: string;
  target_id: string | null;
  payload: Record<string, unknown>;
  ip: string | null;
  at: string;
  actor_email: string | null;
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ target_kind?: string; target_id?: string }>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  qs.set('limit', '100');
  if (sp.target_kind) qs.set('target_kind', sp.target_kind);
  if (sp.target_id) qs.set('target_id', sp.target_id);

  let entries: AuditEntry[];
  try {
    ({ entries } = await apiFetch<{ entries: AuditEntry[] }>(`/api/audit?${qs.toString()}`));
  } catch (err) {
    if ((err as Error).message.includes('401')) redirect('/login');
    throw err;
  }

  return (
    <>
      <TopNav />
      <main className="max-w-6xl mx-auto px-6 py-8">
        <h1 className="text-lg font-semibold mb-1">Audit log</h1>
        <p className="text-sm text-(--color-muted) mb-6">
          Latest {entries.length} events
          {sp.target_kind && <> filtered to <code className="mono">{sp.target_kind}</code></>}
          {sp.target_id && <> on <code className="mono">{sp.target_id}</code></>}.
        </p>

        <div className="border border-(--color-border) rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-(--color-surface) text-(--color-muted)">
              <tr>
                <th className="text-left px-3 py-2 font-medium w-44">At</th>
                <th className="text-left px-3 py-2 font-medium w-56">Actor</th>
                <th className="text-left px-3 py-2 font-medium w-44">Action</th>
                <th className="text-left px-3 py-2 font-medium">Target</th>
                <th className="text-left px-3 py-2 font-medium">Payload</th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 ? (
                <tr><td colSpan={5} className="px-3 py-8 text-center text-(--color-muted)">No audit entries.</td></tr>
              ) : (
                entries.map((e) => (
                  <tr key={e.id} className="border-t border-(--color-border) align-top">
                    <td className="px-3 py-2 mono text-xs text-(--color-muted)">
                      {new Date(e.at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 mono text-xs">
                      {e.actor_email ?? <span className="text-(--color-muted)">system</span>}
                      {e.ip && <div className="text-(--color-muted) opacity-70">{e.ip}</div>}
                    </td>
                    <td className="px-3 py-2 mono text-xs">{e.action}</td>
                    <td className="px-3 py-2 mono text-xs">
                      {e.target_kind}
                      {e.target_id && <div className="text-(--color-muted) opacity-70 truncate">{e.target_id}</div>}
                    </td>
                    <td className="px-3 py-2 mono text-xs text-(--color-muted) max-w-md truncate">
                      {Object.keys(e.payload).length > 0 ? JSON.stringify(e.payload) : ''}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
