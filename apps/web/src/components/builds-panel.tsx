'use client';

import { Fragment, useState } from 'react';
import useSWR from 'swr';
import { Button, Callout } from '@/components/ui';
import type { Build, BuildStatus, GithubSource } from '@/lib/types';

const fetcher = (url: string) => fetch(url, { credentials: 'include' }).then((r) => r.json());

const TERMINAL: BuildStatus[] = ['success', 'failed'];

function statusClass(s: BuildStatus): string {
  if (s === 'success') return 'text-(--color-healthy)';
  if (s === 'failed') return 'text-(--color-error)';
  return 'text-(--color-warn)';
}

function duration(start: string | null, end: string | null): string {
  if (!start) return '—';
  const a = new Date(start).getTime();
  const b = end ? new Date(end).getTime() : Date.now();
  const s = Math.max(0, Math.round((b - a) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60}s`;
}

export function BuildsPanel({
  serviceId,
  source,
}: {
  serviceId: string;
  source: GithubSource;
}) {
  const { data, mutate } = useSWR<{ builds: Build[] }>(
    `/api/services/${serviceId}/builds`,
    fetcher,
    {
      // Poll while a build is in flight so the operator sees live status.
      refreshInterval: (latest) =>
        latest?.builds.some((b) => !TERMINAL.includes(b.status)) ? 3000 : 0,
    },
  );
  const [rebuilding, setRebuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openBuild, setOpenBuild] = useState<string | null>(null);

  const builds = data?.builds ?? [];

  async function onRebuild() {
    setError(null);
    setRebuilding(true);
    try {
      const res = await fetch(`/api/services/${serviceId}/builds`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
        credentials: 'include',
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({ error: 'rebuild failed' }));
        setError(payload.error ?? 'rebuild failed');
        return;
      }
      await mutate();
    } finally {
      setRebuilding(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-(--color-muted) mono">
          {source.repo_full_name} @ {source.branch}
          <span className="text-(--color-muted)/60"> · {source.dockerfile_path}</span>
        </div>
        <Button onClick={onRebuild} disabled={rebuilding}>
          {rebuilding ? 'Queuing…' : 'Rebuild from latest'}
        </Button>
      </div>

      {error && <Callout tone="error">{error}</Callout>}

      {builds.length === 0 ? (
        <div className="text-xs text-(--color-muted) italic">No builds yet.</div>
      ) : (
        <div className="border border-(--color-border) rounded overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-(--color-surface) text-(--color-muted)">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="text-left px-3 py-2 font-medium">Commit</th>
                <th className="text-left px-3 py-2 font-medium">Trigger</th>
                <th className="text-left px-3 py-2 font-medium">Duration</th>
                <th className="text-right px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {builds.map((b) => (
                <Fragment key={b.id}>
                  <tr className="border-t border-(--color-border)">
                    <td className={`px-3 py-2 text-xs font-medium ${statusClass(b.status)}`}>
                      {b.status}
                    </td>
                    <td className="px-3 py-2 mono text-xs">
                      {b.commit_sha ? (
                        <>
                          <span>{b.commit_sha.slice(0, 8)}</span>
                          <span className="text-(--color-muted) ml-2">
                            {b.commit_message ?? ''}
                          </span>
                        </>
                      ) : (
                        <span className="text-(--color-muted)">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 mono text-xs text-(--color-muted)">{b.triggered_by}</td>
                    <td className="px-3 py-2 mono text-xs text-(--color-muted)">
                      {duration(b.started_at, b.finished_at)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        variant="secondary"
                        onClick={() => setOpenBuild(openBuild === b.id ? null : b.id)}
                      >
                        {openBuild === b.id ? 'Hide log' : 'Log'}
                      </Button>
                    </td>
                  </tr>
                  {openBuild === b.id && (
                    <tr className="border-t border-(--color-border)">
                      <td colSpan={5} className="px-3 py-2 bg-(--color-bg)">
                        <BuildLog serviceId={serviceId} buildId={b.id} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function BuildLog({ serviceId, buildId }: { serviceId: string; buildId: string }) {
  const { data } = useSWR<{ build: Build }>(
    `/api/services/${serviceId}/builds/${buildId}`,
    fetcher,
  );
  const build = data?.build;
  if (!build) return <div className="text-xs text-(--color-muted) italic">Loading log…</div>;
  return (
    <div className="space-y-2">
      {build.error_message && (
        <div className="text-xs text-(--color-error) mono">{build.error_message}</div>
      )}
      <pre className="text-xs mono whitespace-pre-wrap max-h-96 overflow-auto text-(--color-muted)">
        {build.log ?? '(no output captured)'}
      </pre>
    </div>
  );
}
