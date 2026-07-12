import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import type { ServiceDetail, ServiceListItem } from '@/lib/types';
import { StatusPill } from '@/components/status-pill';
import { resolvePanels } from '@/panels/registry';

interface OverviewPayload {
  service: ServiceDetail;
  deployments: Array<{ id: string; version: number; image: string; image_digest: string | null; status: string; created_at: string }>;
  siblings: ServiceListItem[];
}

export default async function ServiceOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await apiFetch<OverviewPayload>(`/api/services/${id}`);
  const panels = resolvePanels(data.service.template);

  return (
    <>
      {panels.length > 0 && (
        <section className="space-y-4">
          {panels.map((Panel, i) => (
            <Panel key={i} serviceId={data.service.id} serviceSlug={data.service.slug} />
          ))}
        </section>
      )}

      {data.siblings.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-2 text-(--color-muted) uppercase tracking-wide">
            Managed siblings
          </h2>
          <div className="border border-(--color-border) rounded overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-(--color-surface) text-(--color-muted)">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Slug</th>
                  <th className="text-left px-3 py-2 font-medium">Kind</th>
                  <th className="text-left px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.siblings.map((s) => (
                  <tr key={s.id} className="border-t border-(--color-border)">
                    <td className="px-3 py-2">
                      <Link href={`/services/${s.id}`} className="hover:underline mono text-xs">{s.slug}</Link>
                    </td>
                    <td className="px-3 py-2 mono text-xs text-(--color-muted)">{s.kind}</td>
                    <td className="px-3 py-2"><StatusPill state={s.current_state} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section>
        <h2 className="text-sm font-semibold mb-2 text-(--color-muted) uppercase tracking-wide">Deployments</h2>
        <div className="border border-(--color-border) rounded overflow-hidden">
          <table className="w-full text-xs mono">
            <thead className="bg-(--color-surface) text-(--color-muted)">
              <tr>
                <th className="text-left px-3 py-2">v</th>
                <th className="text-left px-3 py-2">image</th>
                <th className="text-left px-3 py-2">digest</th>
                <th className="text-left px-3 py-2">status</th>
                <th className="text-left px-3 py-2">at</th>
              </tr>
            </thead>
            <tbody>
              {data.deployments.map((d) => (
                <tr key={d.id} className="border-t border-(--color-border)">
                  <td className="px-3 py-2">{d.version}</td>
                  <td className="px-3 py-2 truncate max-w-xs">{d.image}</td>
                  <td className="px-3 py-2 text-(--color-muted)">{d.image_digest?.slice(0, 19) ?? '—'}</td>
                  <td className="px-3 py-2">{d.status}</td>
                  <td className="px-3 py-2 text-(--color-muted)">{new Date(d.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
