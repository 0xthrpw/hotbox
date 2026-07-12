'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
// Subpath import, NOT the barrel: this is a client component and the barrel
// re-exports template-loader, whose node:fs import would break the browser
// bundle at next build.
import { parseCommandLine } from '@hotbox/shared/command';
import { Button, Callout, Field, Input, Select } from '@/components/ui';
import type { GithubSource, ServiceConfig } from '@/lib/types';

async function patchJson(url: string, body: unknown): Promise<string | null> {
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'include',
  });
  if (res.ok) return null;
  const payload = await res.json().catch(() => ({ error: 'update failed' }));
  return payload.error ?? 'update failed';
}

export function NameEditor({ serviceId, initialName }: { serviceId: string; initialName: string }) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const dirty = name.trim() !== initialName && name.trim() !== '';

  async function onSave() {
    setError(null);
    setSubmitting(true);
    try {
      const err = await patchJson(`/api/services/${serviceId}`, { name: name.trim() });
      if (err) { setError(err); return; }
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="border border-(--color-border) rounded p-3 space-y-3">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Field label="Display name" hint="slug is immutable — subdomains and volumes derive from it">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <Button onClick={onSave} disabled={!dirty || submitting}>
          {submitting ? 'Saving…' : 'Save'}
        </Button>
      </div>
      {error && <Callout tone="error">{error}</Callout>}
    </div>
  );
}

export function SourceEditor({ serviceId, source }: { serviceId: string; source: GithubSource }) {
  const router = useRouter();
  const [repo, setRepo] = useState(source.repo_full_name);
  const [branch, setBranch] = useState(source.branch);
  const [dockerfile, setDockerfile] = useState(source.dockerfile_path);
  const [context, setContext] = useState(source.build_context);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const dirty =
    repo !== source.repo_full_name ||
    branch !== source.branch ||
    dockerfile !== source.dockerfile_path ||
    context !== source.build_context;

  async function onSave(rebuild: boolean) {
    setError(null);
    setSubmitting(true);
    try {
      const err = await patchJson(`/api/services/${serviceId}/source`, {
        repo_full_name: repo,
        branch,
        dockerfile_path: dockerfile,
        build_context: context,
      });
      if (err) { setError(err); return; }
      if (rebuild) {
        const res = await fetch(`/api/services/${serviceId}/builds`, {
          method: 'POST',
          credentials: 'include',
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({ error: 'rebuild failed' }));
          setError(`saved, but rebuild failed: ${payload.error ?? 'unknown'}`);
          return;
        }
      }
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="border border-(--color-border) rounded p-3 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Repository" hint="owner/repo">
          <Input
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            pattern="^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$"
          />
        </Field>
        <Field label="Branch">
          <Input value={branch} onChange={(e) => setBranch(e.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Dockerfile path" hint="relative to build context">
          <Input value={dockerfile} onChange={(e) => setDockerfile(e.target.value)} />
        </Field>
        <Field label="Build context" hint="relative to repo root">
          <Input value={context} onChange={(e) => setContext(e.target.value)} />
        </Field>
      </div>
      <p className="text-xs text-(--color-muted)">
        Changes apply to the next build. Existing deployments keep running until one lands.
      </p>
      {error && <Callout tone="error">{error}</Callout>}
      <div className="flex items-center gap-2">
        <Button onClick={() => onSave(false)} disabled={!dirty || submitting}>
          {submitting ? 'Saving…' : 'Save'}
        </Button>
        <Button variant="secondary" onClick={() => onSave(true)} disabled={!dirty || submitting}>
          Save &amp; rebuild
        </Button>
      </div>
    </div>
  );
}

export function RuntimeEditor({
  serviceId,
  config,
  isTemplate,
}: {
  serviceId: string;
  config: ServiceConfig;
  isTemplate: boolean;
}) {
  const router = useRouter();
  const [command, setCommand] = useState(config.command?.join(' ') ?? '');
  const [entrypoint, setEntrypoint] = useState(config.entrypoint?.join(' ') ?? '');
  const [restartPolicy, setRestartPolicy] = useState(config.restart_policy ?? 'on-failure');
  const [graceSec, setGraceSec] = useState(
    config.stop_grace_period_sec != null ? String(config.stop_grace_period_sec) : '',
  );
  const [cpu, setCpu] = useState(
    config.resources?.cpu_quota != null ? String(config.resources.cpu_quota) : '',
  );
  const [memMb, setMemMb] = useState(
    config.resources?.mem_limit_bytes != null
      ? String(Math.round(config.resources.mem_limit_bytes / (1024 * 1024)))
      : '',
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function buildBody(): Record<string, unknown> | { parseError: string } {
    const body: Record<string, unknown> = {
      restart_policy: restartPolicy,
    };
    if (!isTemplate) {
      try {
        body.command = command.trim() ? parseCommandLine(command) : null;
        body.entrypoint = entrypoint.trim() ? parseCommandLine(entrypoint) : null;
      } catch (err) {
        return { parseError: err instanceof Error ? err.message : 'invalid command line' };
      }
    }
    if (graceSec.trim()) body.stop_grace_period_sec = Number(graceSec);
    const cpuVal = cpu.trim() ? Number(cpu) : null;
    const memVal = memMb.trim() ? Number(memMb) * 1024 * 1024 : null;
    body.resources =
      cpuVal === null && memVal === null
        ? null
        : {
            ...(cpuVal !== null ? { cpu_quota: cpuVal } : {}),
            ...(memVal !== null ? { mem_limit_bytes: memVal } : {}),
          };
    return body;
  }

  async function onSave(redeploy: boolean) {
    setError(null);
    const body = buildBody();
    if ('parseError' in body) { setError(body.parseError as string); return; }
    setSubmitting(true);
    try {
      const err = await patchJson(`/api/services/${serviceId}/config`, body);
      if (err) { setError(err); return; }
      if (redeploy) {
        const res = await fetch(`/api/services/${serviceId}/deployments`, {
          method: 'POST',
          credentials: 'include',
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({ error: 'redeploy failed' }));
          setError(`saved, but redeploy failed: ${payload.error ?? 'unknown'}`);
          return;
        }
      }
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="border border-(--color-border) rounded p-3 space-y-3">
      {!isTemplate && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start command" hint="blank = image default">
            <Input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="node server.js --port 8080" />
          </Field>
          <Field label="Entrypoint" hint="blank = image default">
            <Input value={entrypoint} onChange={(e) => setEntrypoint(e.target.value)} />
          </Field>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Restart policy">
          <Select value={restartPolicy} onChange={(e) => setRestartPolicy(e.target.value as typeof restartPolicy)}>
            <option value="on-failure">on-failure</option>
            <option value="always">always</option>
            <option value="unless-stopped">unless-stopped</option>
            <option value="no">no</option>
          </Select>
        </Field>
        <Field label="Stop grace period" hint="seconds">
          <Input type="number" value={graceSec} onChange={(e) => setGraceSec(e.target.value)} placeholder="30" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="CPU limit" hint="cores, blank = unlimited">
          <Input type="number" step="0.5" value={cpu} onChange={(e) => setCpu(e.target.value)} placeholder="2" />
        </Field>
        <Field label="Memory limit" hint="MB, blank = unlimited">
          <Input type="number" value={memMb} onChange={(e) => setMemMb(e.target.value)} placeholder="2048" />
        </Field>
      </div>
      <p className="text-xs text-(--color-muted)">
        Saved values apply on the next deployment — &ldquo;Save &amp; redeploy&rdquo; applies them now.
      </p>
      {error && <Callout tone="error">{error}</Callout>}
      <div className="flex items-center gap-2">
        <Button onClick={() => onSave(false)} disabled={submitting}>
          {submitting ? 'Saving…' : 'Save'}
        </Button>
        <Button variant="secondary" onClick={() => onSave(true)} disabled={submitting}>
          Save &amp; redeploy
        </Button>
      </div>
    </div>
  );
}
