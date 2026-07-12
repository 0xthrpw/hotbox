import type { ReactNode } from 'react';
import { apiFetch } from '@/lib/api';
import type { ServiceDetail } from '@/lib/types';
import { TopNav } from '@/components/nav';
import { StatusPill } from '@/components/status-pill';
import { ServiceActions } from '@/components/service-actions';
import { ServiceTabs } from '@/components/service-tabs';

/**
 * Shared frame for the service sub-pages: header (status, slug, actions) +
 * tab nav. Each tab page re-fetches the service payload it needs — the
 * fetches are internal and no-store, so freshness beats deduplication.
 */
export default async function ServiceLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: ReactNode;
}) {
  const { id } = await params;
  const { service } = await apiFetch<{ service: ServiceDetail }>(`/api/services/${id}`);

  return (
    <>
      <TopNav />
      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold flex items-center gap-3">
              <StatusPill state={service.current_state} />
              {service.slug}
            </h1>
            <p className="text-(--color-muted) text-sm">{service.name}</p>
            <p className="text-xs text-(--color-muted) mono mt-1">
              {service.project_slug} / {service.environment_slug}
            </p>
          </div>
          <ServiceActions serviceId={service.id} desiredState={service.desired_state} />
        </header>

        <ServiceTabs serviceId={id} />

        {children}
      </main>
    </>
  );
}
