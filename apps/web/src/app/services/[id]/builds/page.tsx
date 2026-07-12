import { apiFetch } from '@/lib/api';
import type { GithubSource, ServiceDetail } from '@/lib/types';
import { BuildsPanel } from '@/components/builds-panel';
import { AutoDeployCard } from '@/components/auto-deploy';
import { DeployHookPanel } from '@/components/deploy-hook';
import { WebhookDeliveries } from '@/components/webhook-deliveries';

interface BuildsPayload {
  service: ServiceDetail;
  github_source: GithubSource | null;
}

export default async function ServiceBuildsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [data, meta] = await Promise.all([
    apiFetch<BuildsPayload>(`/api/services/${id}`),
    apiFetch<{ api_public_url: string | null }>('/api/meta'),
  ]);
  const isGithub = data.service.image_source === 'github' && data.github_source;

  return (
    <>
      {isGithub && data.github_source ? (
        <>
          <section>
            <h2 className="text-sm font-semibold mb-2 text-(--color-muted) uppercase tracking-wide">
              Builds
            </h2>
            <BuildsPanel serviceId={data.service.id} source={data.github_source} />
          </section>
          <section>
            <h2 className="text-sm font-semibold mb-2 text-(--color-muted) uppercase tracking-wide">
              Webhook deliveries
            </h2>
            <WebhookDeliveries serviceId={data.service.id} />
          </section>
          <section>
            <h2 className="text-sm font-semibold mb-2 text-(--color-muted) uppercase tracking-wide">
              Auto-deploy on push
            </h2>
            <AutoDeployCard
              serviceId={data.service.id}
              source={data.github_source}
              apiBase={meta.api_public_url}
            />
          </section>
        </>
      ) : (
        <p className="text-xs text-(--color-muted)">
          This service deploys a registry image, so there are no source builds. Point CI at the
          deploy hook below to cut a new deployment when your pipeline pushes a fresh image.
        </p>
      )}

      <section>
        <h2 className="text-sm font-semibold mb-2 text-(--color-muted) uppercase tracking-wide">
          CI deploy hook
        </h2>
        <DeployHookPanel
          serviceId={data.service.id}
          imageSource={data.service.image_source}
          apiBase={meta.api_public_url}
        />
      </section>
    </>
  );
}
