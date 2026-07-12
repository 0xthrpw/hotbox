// Subpath import — value imports of the @hotbox/shared barrel don't survive
// the web bundler (TS-style .js re-exports + node-only template-loader).
import { dockerVolumeName } from '@hotbox/shared/naming';
import { apiFetch } from '@/lib/api';
import type { GithubSource, ServiceDetail } from '@/lib/types';
import { IngressEditor } from '@/components/ingress-editor';
import { NameEditor, RuntimeEditor, SourceEditor } from '@/components/service-settings';

interface SettingsPayload {
  service: ServiceDetail;
  github_source: GithubSource | null;
}

export default async function ServiceSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await apiFetch<SettingsPayload>(`/api/services/${id}`);
  const { service } = data;

  return (
    <>
      <section>
        <h2 className="text-sm font-semibold mb-2 text-(--color-muted) uppercase tracking-wide">
          Service
        </h2>
        <NameEditor serviceId={service.id} initialName={service.name} />
      </section>

      {service.image_source === 'github' && data.github_source && (
        <section>
          <h2 className="text-sm font-semibold mb-2 text-(--color-muted) uppercase tracking-wide">
            GitHub source
          </h2>
          <SourceEditor serviceId={service.id} source={data.github_source} />
        </section>
      )}

      <section>
        <h2 className="text-sm font-semibold mb-2 text-(--color-muted) uppercase tracking-wide">
          Runtime
        </h2>
        <RuntimeEditor
          serviceId={service.id}
          config={service.config}
          isTemplate={Boolean(service.template)}
        />
      </section>

      <section>
        <h2 className="text-sm font-semibold mb-2 text-(--color-muted) uppercase tracking-wide">
          Ingress
        </h2>
        <IngressEditor
          serviceId={service.id}
          serviceSlug={service.slug}
          projectSlug={service.project_slug}
          envSlug={service.environment_slug}
          initial={{
            hostname: service.hostname,
            public_port: service.public_port,
            auto_subdomain: service.auto_subdomain,
          }}
        />
      </section>

      {(service.config.volumes?.length ?? 0) > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-2 text-(--color-muted) uppercase tracking-wide">
            Volumes
          </h2>
          <div className="border border-(--color-border) rounded overflow-hidden">
            <table className="w-full text-xs mono">
              <thead className="bg-(--color-surface) text-(--color-muted)">
                <tr>
                  <th className="text-left px-3 py-2">volume</th>
                  <th className="text-left px-3 py-2">mountpoint</th>
                  <th className="text-left px-3 py-2">mode</th>
                  <th className="text-left px-3 py-2">docker volume</th>
                </tr>
              </thead>
              <tbody>
                {service.config.volumes!.map((v) => (
                  <tr key={v.name} className="border-t border-(--color-border)">
                    <td className="px-3 py-2">{v.name}</td>
                    <td className="px-3 py-2">{v.mountpoint}</td>
                    <td className="px-3 py-2 text-(--color-muted)">{v.ro ? 'ro' : 'rw'}</td>
                    <td className="px-3 py-2 text-(--color-muted)">
                      {dockerVolumeName({
                        projectSlug: service.project_slug,
                        environmentSlug: service.environment_slug,
                        serviceSlug: service.slug,
                        name: v.name,
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-(--color-muted) mt-2">
            Volumes are fixed at creation — adding or removing mounts is deliberately not
            editable here.
          </p>
        </section>
      )}
    </>
  );
}
