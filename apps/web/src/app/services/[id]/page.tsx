import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import type { ServiceDetail, ServiceListItem } from '@/lib/types';
import { TopNav } from '@/components/nav';
import { StatusPill } from '@/components/status-pill';
import { LogViewer } from '@/components/log-viewer';
import { ServiceActions } from '@/components/service-actions';
import { resolvePanels } from '@/panels/registry';

interface ServicePayload {
  service: ServiceDetail;
  deployments: Array<{ id: string; version: number; image: string; image_digest: string | null; status: string; created_at: string }>;
  containers: Array<{ id: string; docker_id: string; state: string; started_at: string | null }>;
  siblings: ServiceListItem[];
}

export default async function ServiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await apiFetch<ServicePayload>(`/api/services/${id}`);
  const panels = resolvePanels(data.service.template);

  return (
    <>
      <TopNav />
      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold flex items-center gap-3">
              <StatusPill state={data.service.current_state} />
              {data.service.slug}
            </h1>
            <p className="text-(--color-muted) text-sm">{data.service.name}</p>
            <p className="text-xs text-(--color-muted) mono mt-1">
              {data.service.hostname ? `${data.service.hostname}:${data.service.public_port ?? '—'}` : 'no ingress'}
            </p>
          </div>
          <ServiceActions
            serviceId={data.service.id}
            desiredState={data.service.desired_state}
          />
        </header>

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
          <h2 className="text-sm font-semibold mb-2 text-(--color-muted) uppercase tracking-wide">Logs</h2>
          <LogViewer serviceId={data.service.id} />
        </section>

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
      </main>
    </>
  );
}
