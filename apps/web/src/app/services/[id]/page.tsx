import { apiFetch } from '@/lib/api';
import type { ServiceDetail } from '@/lib/types';
import { TopNav } from '@/components/nav';
import { StatusPill } from '@/components/status-pill';
import { LogViewer } from '@/components/log-viewer';
import { resolvePanels } from '@/panels/registry';

interface ServicePayload {
  service: ServiceDetail;
  deployments: Array<{ id: string; version: number; image: string; image_digest: string | null; status: string; created_at: string }>;
  containers: Array<{ id: string; docker_id: string; state: string; started_at: string | null }>;
}

export default async function ServiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await apiFetch<ServicePayload>(`/api/services/${id}`);
  const panels = resolvePanels(data.service.template);

  return (
    <>
      <TopNav />
      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold flex items-center gap-3">
              <StatusPill state={data.service.current_state} />
              {data.service.slug}
            </h1>
            <p className="text-(--color-muted) text-sm">{data.service.name}</p>
          </div>
          <div className="text-xs text-(--color-muted) mono">
            {data.service.hostname ? `${data.service.hostname}:${data.service.public_port ?? '—'}` : 'no ingress'}
          </div>
        </header>

        {panels.length > 0 && (
          <section className="space-y-4">
            {panels.map((Panel, i) => (
              <Panel key={i} serviceId={data.service.id} serviceSlug={data.service.slug} />
            ))}
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
