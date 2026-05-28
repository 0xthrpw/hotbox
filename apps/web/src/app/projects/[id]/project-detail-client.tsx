'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Callout, Field, Input } from '@/components/ui';
import { StatusPill } from '@/components/status-pill';
import type {
  EnvironmentWithCount,
  Project,
  ServiceListItem,
} from '@/lib/types';

export function ProjectDetailClient({
  project,
  environments,
  activeEnvId,
  activeServices,
}: {
  project: Project;
  environments: EnvironmentWithCount[];
  activeEnvId: string | null;
  activeServices: ServiceListItem[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [creatingEnv, setCreatingEnv] = useState(false);
  const [duplicatingEnv, setDuplicatingEnv] = useState<EnvironmentWithCount | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const activeEnv = environments.find((e) => e.id === activeEnvId) ?? null;

  function changeEnv(slug: string) {
    const sp = new URLSearchParams(params.toString());
    sp.set('env', slug);
    router.push(`/projects/${project.id}?${sp.toString()}`);
  }

  async function onDeleteEnv(env: EnvironmentWithCount) {
    setActionError(null);
    if (env.service_count > 0) {
      setActionError(`Environment '${env.slug}' has ${env.service_count} services. Archive them first.`);
      return;
    }
    if (!confirm(`Delete environment '${env.slug}'? This cannot be undone.`)) return;
    const res = await fetch(`/api/projects/${project.id}/environments/${env.id}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({ error: 'delete failed' }));
      setActionError(payload.error ?? 'delete failed');
      return;
    }
    router.refresh();
  }

  return (
    <>
      <div className="flex items-center justify-between mb-2">
        <div>
          <Link href="/projects" className="text-xs text-(--color-muted) hover:underline">
            ← Projects
          </Link>
          <h1 className="text-lg font-semibold mt-1">{project.name}</h1>
          <div className="text-xs text-(--color-muted) mono">{project.slug}</div>
        </div>
        <div className="flex items-center gap-2">
          {activeEnv && (
            <Link
              href={`/services/new?projectId=${project.id}&envId=${activeEnv.id}`}
              className="text-sm px-3 py-1.5 rounded bg-(--color-accent) text-white hover:opacity-90"
            >
              + New service
            </Link>
          )}
          <Button variant="secondary" onClick={() => setCreatingEnv(true)} disabled={creatingEnv}>
            + Environment
          </Button>
        </div>
      </div>

      {actionError && <div className="mb-3"><Callout tone="error">{actionError}</Callout></div>}

      {creatingEnv && (
        <CreateEnvForm
          projectId={project.id}
          onClose={(success) => {
            setCreatingEnv(false);
            if (success) router.refresh();
          }}
        />
      )}

      {duplicatingEnv && (
        <DuplicateEnvForm
          projectId={project.id}
          source={duplicatingEnv}
          onClose={(success) => {
            setDuplicatingEnv(null);
            if (success) router.refresh();
          }}
        />
      )}

      {environments.length === 0 ? (
        <div className="border border-(--color-border) rounded-lg p-8 text-center text-(--color-muted) mt-4">
          No environments yet. Create one to add services.
        </div>
      ) : (
        <>
          <div className="border-b border-(--color-border) flex items-end gap-1 mt-4 mb-0 overflow-x-auto">
            {environments.map((env) => {
              const active = env.id === activeEnvId;
              return (
                <button
                  key={env.id}
                  onClick={() => changeEnv(env.slug)}
                  className={
                    'px-3 py-2 text-sm border-b-2 -mb-px ' +
                    (active
                      ? 'border-(--color-accent) text-(--color-text)'
                      : 'border-transparent text-(--color-muted) hover:text-(--color-text)')
                  }
                >
                  <span className="mono">{env.slug}</span>
                  <span className="ml-2 text-xs text-(--color-muted)">{env.service_count}</span>
                </button>
              );
            })}
          </div>

          {activeEnv && (
            <div className="mt-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs text-(--color-muted)">
                  <span className="mono">{activeEnv.slug}</span> · {activeEnv.name}
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="secondary" onClick={() => setDuplicatingEnv(activeEnv)}>
                    Duplicate
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => onDeleteEnv(activeEnv)}
                    disabled={activeEnv.service_count > 0}
                    title={activeEnv.service_count > 0 ? 'Archive services in this env first' : undefined}
                  >
                    Delete
                  </Button>
                </div>
              </div>

              <div className="border border-(--color-border) rounded-lg overflow-hidden">
                {activeServices.length === 0 ? (
                  <div className="p-8 text-center text-(--color-muted)">
                    No services in <span className="mono">{activeEnv.slug}</span> yet.
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-(--color-surface) text-(--color-muted)">
                      <tr>
                        <th className="text-left px-4 py-2 font-medium">Service</th>
                        <th className="text-left px-4 py-2 font-medium">Kind</th>
                        <th className="text-left px-4 py-2 font-medium">Status</th>
                        <th className="text-left px-4 py-2 font-medium">Hostname</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeServices.map((s) => (
                        <tr
                          key={s.id}
                          className="border-t border-(--color-border) hover:bg-(--color-surface-2)"
                        >
                          <td className="px-4 py-3">
                            <Link href={`/services/${s.id}`} className="font-medium hover:underline">
                              {s.slug}
                            </Link>
                            <div className="text-(--color-muted) text-xs">{s.name}</div>
                          </td>
                          <td className="px-4 py-3 text-(--color-muted) mono text-xs">
                            {s.template ?? s.kind}
                          </td>
                          <td className="px-4 py-3"><StatusPill state={s.current_state} /></td>
                          <td className="px-4 py-3 mono text-xs text-(--color-muted)">
                            {s.hostname ?? '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}

function CreateEnvForm({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: (success: boolean) => void;
}) {
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
      const res = await fetch(`/api/projects/${projectId}/environments`, {
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
      onClose(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mb-4 border border-(--color-border) rounded p-4 space-y-3 bg-(--color-surface)"
    >
      <div className="text-sm font-medium">New environment</div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name">
          <Input value={name} onChange={(e) => onNameChange(e.target.value)} placeholder="Dev" required />
        </Field>
        <Field label="Slug" hint="lowercase, dashes">
          <Input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="dev"
            pattern="^[a-z0-9][a-z0-9-]*[a-z0-9]$"
            required
          />
        </Field>
      </div>
      {error && <Callout tone="error">{error}</Callout>}
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={submitting}>{submitting ? 'Creating…' : 'Create'}</Button>
        <Button type="button" variant="secondary" onClick={() => onClose(false)}>Cancel</Button>
      </div>
    </form>
  );
}

function DuplicateEnvForm({
  projectId,
  source,
  onClose,
}: {
  projectId: string;
  source: EnvironmentWithCount;
  onClose: (success: boolean) => void;
}) {
  const [name, setName] = useState(`${source.name} copy`);
  const [slug, setSlug] = useState(`${source.slug}-copy`);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/environments/${source.id}/duplicate`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name, slug }),
          credentials: 'include',
        },
      );
      if (!res.ok) {
        const payload = await res.json().catch(() => ({ error: 'duplicate failed' }));
        setError(payload.error ?? 'duplicate failed');
        return;
      }
      onClose(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mb-4 border border-(--color-border) rounded p-4 space-y-3 bg-(--color-surface)"
    >
      <div className="text-sm font-medium">
        Duplicate <span className="mono">{source.slug}</span>
      </div>
      <p className="text-xs text-(--color-muted)">
        Copies every service&apos;s configuration into the new environment. Volumes start
        empty — duplicate is config-only, fresh state.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="New name">
          <Input value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="New slug" hint="lowercase, dashes">
          <Input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            pattern="^[a-z0-9][a-z0-9-]*[a-z0-9]$"
            required
          />
        </Field>
      </div>
      {error && <Callout tone="error">{error}</Callout>}
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Duplicating…' : 'Duplicate environment'}
        </Button>
        <Button type="button" variant="secondary" onClick={() => onClose(false)}>Cancel</Button>
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
