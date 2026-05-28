'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Callout, Field, Input } from '@/components/ui';
import type { ProjectWithEnvironments } from '@/lib/types';

export function ProjectsClient({ initialProjects }: { initialProjects: ProjectWithEnvironments[] }) {
  const [projects, setProjects] = useState(initialProjects);
  const [creating, setCreating] = useState(false);

  function onCreated(project: ProjectWithEnvironments) {
    setProjects([project, ...projects]);
    setCreating(false);
  }

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-semibold">Projects</h1>
        <Button onClick={() => setCreating(true)} disabled={creating}>+ New project</Button>
      </div>

      {creating && <CreateProjectForm onCreated={onCreated} onCancel={() => setCreating(false)} />}

      {projects.length === 0 ? (
        <div className="border border-(--color-border) rounded-lg p-8 text-center text-(--color-muted)">
          No projects yet. The first one is on you.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {projects.map((p) => (
            <Link
              key={p.id}
              href={`/projects/${p.id}`}
              className="border border-(--color-border) rounded-lg p-4 hover:bg-(--color-surface-2) block"
            >
              <div className="flex items-baseline justify-between mb-2">
                <div className="font-medium">{p.name}</div>
                <span className="mono text-xs text-(--color-muted)">{p.slug}</span>
              </div>
              <div className="text-xs text-(--color-muted)">
                {p.environments.length === 0
                  ? <span className="italic">no environments</span>
                  : p.environments.map((e) => e.slug).join(' · ')}
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

function CreateProjectForm({
  onCreated,
  onCancel,
}: {
  onCreated: (p: ProjectWithEnvironments) => void;
  onCancel: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function onNameChange(v: string) {
    setName(v);
    if (!slug || slug === slugify(name)) setSlug(slugify(v));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, slug }),
        credentials: 'include',
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({ error: 'create failed' }));
        setError(payload.error ?? 'create failed');
        return;
      }
      const { project } = await res.json();
      onCreated({ ...project, environments: [] });
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mb-4 border border-(--color-border) rounded p-4 space-y-3 bg-(--color-surface)"
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name">
          <Input value={name} onChange={(e) => onNameChange(e.target.value)} placeholder="Widget Sales" required />
        </Field>
        <Field label="Slug" hint="lowercase, dashes">
          <Input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="widget-sales"
            pattern="^[a-z0-9][a-z0-9-]*[a-z0-9]$"
            required
          />
        </Field>
      </div>
      {error && <Callout tone="error">{error}</Callout>}
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Creating…' : 'Create project'}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 40);
}
