import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import type { ServiceListItem } from '@/lib/types';
import { TopNav } from '@/components/nav';
import { StatusPill } from '@/components/status-pill';

export default async function Dashboard() {
  let data: { services: ServiceListItem[] };
  try {
    data = await apiFetch<{ services: ServiceListItem[] }>('/api/services');
  } catch (err) {
    if ((err as Error).message.includes('401')) redirect('/login');
    throw err;
  }

  return (
    <>
      <TopNav />
      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-lg font-semibold">Services</h1>
          <Link
            href="/services/new"
            className="text-sm px-3 py-1.5 rounded bg-(--color-accent) text-white hover:opacity-90"
          >
            + New service
          </Link>
        </div>

        <div className="border border-(--color-border) rounded-lg overflow-hidden">
          {data.services.length === 0 ? (
            <div className="p-8 text-center text-(--color-muted)">
              No services yet. Create one to get started.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-(--color-surface) text-(--color-muted)">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Service</th>
                  <th className="text-left px-4 py-2 font-medium">Kind</th>
                  <th className="text-left px-4 py-2 font-medium">Status</th>
                  <th className="text-left px-4 py-2 font-medium">Hostname</th>
                </tr>
              </thead>
              <tbody>
                {data.services.map((s) => (
                  <tr key={s.id} className="border-t border-(--color-border) hover:bg-(--color-surface-2)">
                    <td className="px-4 py-3">
                      <Link href={`/services/${s.id}`} className="font-medium hover:underline">{s.slug}</Link>
                      <div className="text-(--color-muted) text-xs">{s.name}</div>
                    </td>
                    <td className="px-4 py-3 text-(--color-muted) mono text-xs">{s.template ?? s.kind}</td>
                    <td className="px-4 py-3"><StatusPill state={s.current_state} /></td>
                    <td className="px-4 py-3 mono text-xs text-(--color-muted)">{s.hostname ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </>
  );
}
