import { apiFetch } from '@/lib/api';
import type { ServiceDetail } from '@/lib/types';
import { LogViewer } from '@/components/log-viewer';

interface LogsPayload {
  service: ServiceDetail;
  deployments: Array<{ id: string }>;
}

export default async function ServiceLogsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await apiFetch<LogsPayload>(`/api/services/${id}`);

  return (
    <section>
      <h2 className="text-sm font-semibold mb-2 text-(--color-muted) uppercase tracking-wide">Logs</h2>
      <LogViewer
        serviceId={id}
        key={`${data.service.current_state}:${data.deployments[0]?.id ?? 'none'}`}
      />
    </section>
  );
}
