import { redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import type { ProjectWithEnvironments } from '@/lib/types';
import { TopNav } from '@/components/nav';
import { ProjectsClient } from './projects-client';

export default async function ProjectsPage() {
  let data: { projects: ProjectWithEnvironments[] };
  try {
    data = await apiFetch<{ projects: ProjectWithEnvironments[] }>('/api/projects');
  } catch (err) {
    if ((err as Error).message.includes('401')) redirect('/login');
    throw err;
  }
  return (
    <>
      <TopNav />
      <main className="max-w-6xl mx-auto px-6 py-8">
        <ProjectsClient initialProjects={data.projects} />
      </main>
    </>
  );
}
