import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import type { GithubSource, ServiceDetail, ServiceListItem } from '@/lib/types';
import { TopNav } from '@/components/nav';
import { StatusPill } from '@/components/status-pill';
import { LogViewer } from '@/components/log-viewer';
import { ServiceActions } from '@/components/service-actions';
import { VariablesPanel } from '@/components/variables-panel';
import { EffectiveVariables } from '@/components/effective-variables';
import { IngressEditor } from '@/components/ingress-editor';
import { BuildsPanel } from '@/components/builds-panel';
import { resolvePanels } from '@/panels/registry';

interface ServicePayload {
  service: ServiceDetail;
  deployments: Array<{ id: string; version: number; image: string; image_digest: string | null; status: string; created_at: string }>;
  containers: Array<{ id: string; docker_id: string; state: string; started_at: string | null }>;
  siblings: ServiceListItem[];
  github_source: GithubSource | null;
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
              {data.service.project_slug} / {data.service.environment_slug}
            </p>
          </div>
          <ServiceActions
            serviceId={data.service.id}
            desiredState={data.service.desired_state}
          />
        </header>

        <IngressEditor
          serviceId={data.service.id}
          serviceSlug={data.service.slug}
          projectSlug={data.service.project_slug}
          envSlug={data.service.environment_slug}
          initial={{
            hostname: data.service.hostname,
            public_port: data.service.public_port,
            auto_subdomain: data.service.auto_subdomain,
          }}
        />

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

        {data.service.image_source === 'github' && data.github_source && (
          <section>
            <h2 className="text-sm font-semibold mb-2 text-(--color-muted) uppercase tracking-wide">
              Builds
            </h2>
            <BuildsPanel serviceId={data.service.id} source={data.github_source} />
          </section>
        )}

        <section>
          <h2 className="text-sm font-semibold mb-2 text-(--color-muted) uppercase tracking-wide">
            Variables
          </h2>
          <p className="text-xs text-(--color-muted) mb-3">
            Service-scoped variables override environment- and project-scoped values of the same
            key. The Effective view below shows what the container actually sees.
          </p>
          <VariablesPanel scope="service" scopeId={data.service.id} />
        </section>

        <section>
          <h2 className="text-sm font-semibold mb-2 text-(--color-muted) uppercase tracking-wide">
            Effective variables
          </h2>
          <EffectiveVariables serviceId={data.service.id} />
        </section>

        <section>
          <h2 className="text-sm font-semibold mb-2 text-(--color-muted) uppercase tracking-wide">Logs</h2>
          <LogViewer
            serviceId={data.service.id}
            key={`${data.service.current_state}:${data.deployments[0]?.id ?? 'none'}`}
          />
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
