import { redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import type {
  EnvironmentWithCount,
  Project,
  ServiceListItem,
} from '@/lib/types';
import { TopNav } from '@/components/nav';
import { ProjectDetailClient } from './project-detail-client';

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ env?: string }>;
}) {
  const { id } = await params;
  const { env: envSlugFromUrl } = await searchParams;

  let detail: { project: Project; environments: EnvironmentWithCount[] };
  try {
    detail = await apiFetch<{ project: Project; environments: EnvironmentWithCount[] }>(
      `/api/projects/${id}`,
    );
  } catch (err) {
    if ((err as Error).message.includes('401')) redirect('/login');
    if ((err as Error).message.includes('404')) redirect('/projects');
    throw err;
  }

  // Pick the active env: from URL, else first env, else null.
  const activeEnv =
    detail.environments.find((e) => e.slug === envSlugFromUrl) ?? detail.environments[0] ?? null;

  let activeServices: ServiceListItem[] = [];
  if (activeEnv) {
    const sresp = await apiFetch<{ services: ServiceListItem[] }>(
      `/api/services?projectId=${id}&environmentId=${activeEnv.id}`,
    );
    activeServices = sresp.services;
  }

  return (
    <>
      <TopNav />
      <main className="max-w-6xl mx-auto px-6 py-8">
        <ProjectDetailClient
          project={detail.project}
          environments={detail.environments}
          activeEnvId={activeEnv?.id ?? null}
          activeServices={activeServices}
        />
      </main>
    </>
  );
}
