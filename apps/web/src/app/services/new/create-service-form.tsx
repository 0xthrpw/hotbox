'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { Button, Callout, Field, Input, Select } from '@/components/ui';

interface TemplateRow {
  id: string;
  label: string;
  description: string;
  primary_image: string | null;
  requires_hostname: boolean;
}

interface EnvRow { key: string; value: string }
interface RequireRow { kind: 'postgres' | 'redis'; name: string }

const fetcher = (url: string) => fetch(url, { credentials: 'include' }).then((r) => r.json());

export function CreateServiceForm() {
  const router = useRouter();
  const { data: tmplData } = useSWR<{ templates: TemplateRow[] }>('/api/templates', fetcher);
  const templates = tmplData?.templates ?? [];

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [template, setTemplate] = useState('');
  const [image, setImage] = useState('');
  const [hostname, setHostname] = useState('');
  const [publicPort, setPublicPort] = useState('');
  const [env, setEnv] = useState<EnvRow[]>([]);
  const [requires, setRequires] = useState<RequireRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selectedTemplate = templates.find((t) => t.id === template);

  // Auto-fill image when a template is picked (only if image hasn't been touched).
  useEffect(() => {
    if (selectedTemplate?.primary_image && !image) {
      setImage(selectedTemplate.primary_image);
    }
  }, [selectedTemplate, image]);

  // Auto-slug from name: lowercase, dashes.
  const onNameChange = (v: string) => {
    setName(v);
    if (!slug || slug === slugify(name)) setSlug(slugify(v));
  };

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        name,
        slug,
        kind: 'app',
        image,
        env: Object.fromEntries(env.filter((row) => row.key).map((row) => [row.key, row.value])),
      };
      if (template) body.template = template;
      if (hostname) body.hostname = hostname;
      if (publicPort) body.public_port = Number(publicPort);
      const filteredRequires = requires.filter((r) => r.name.trim());
      if (filteredRequires.length > 0) {
        body.config = { requires: filteredRequires };
      }

      const res = await fetch('/api/services', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'include',
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({ error: 'create failed' }));
        setError(payload.error ?? 'create failed');
        return;
      }
      const result = await res.json();
      router.push(`/services/${result.service.id}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name">
          <Input value={name} onChange={(e) => onNameChange(e.target.value)} placeholder="my-api" required />
        </Field>
        <Field label="Slug" hint="lowercase, dashes; must be unique">
          <Input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            pattern="^[a-z0-9][a-z0-9-]*[a-z0-9]$"
            required
          />
        </Field>
      </div>

      <Field label="Template" hint="optional">
        <Select value={template} onChange={(e) => setTemplate(e.target.value)}>
          <option value="">— none —</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </Select>
      </Field>
      {selectedTemplate && (
        <p className="text-xs text-(--color-muted) -mt-2">{selectedTemplate.description}</p>
      )}

      <Field label="Image" hint="image:tag or image@sha256:...">
        <Input value={image} onChange={(e) => setImage(e.target.value)} placeholder="ghcr.io/org/app:latest" required />
      </Field>

      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <Field label="Hostname" hint={selectedTemplate?.requires_hostname ? 'required for this template' : 'optional'}>
            <Input
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
              placeholder="api.example.com"
              required={selectedTemplate?.requires_hostname}
            />
          </Field>
        </div>
        <Field label="Public port">
          <Input type="number" value={publicPort} onChange={(e) => setPublicPort(e.target.value)} placeholder="8080" />
        </Field>
      </div>

      <div>
        <div className="text-xs text-(--color-muted) mb-2 flex items-center justify-between">
          <span>Environment variables</span>
          <button
            type="button"
            onClick={() => setEnv([...env, { key: '', value: '' }])}
            className="text-(--color-accent) hover:underline text-xs"
          >+ add</button>
        </div>
        {env.length === 0 ? (
          <div className="text-xs text-(--color-muted)/70 italic">No env vars</div>
        ) : (
          <div className="space-y-2">
            {env.map((row, i) => (
              <div key={i} className="grid grid-cols-[1fr_2fr_auto] gap-2">
                <Input
                  value={row.key}
                  onChange={(e) => setEnv(env.map((r, j) => (i === j ? { ...r, key: e.target.value } : r)))}
                  placeholder="KEY"
                />
                <Input
                  value={row.value}
                  onChange={(e) => setEnv(env.map((r, j) => (i === j ? { ...r, value: e.target.value } : r)))}
                  placeholder="value"
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setEnv(env.filter((_, j) => j !== i))}
                >×</Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="text-xs text-(--color-muted) mb-2 flex items-start justify-between gap-4">
          <div>
            <div>Requires</div>
            <p className="text-(--color-muted)/70 mt-0.5">
              Spin up a managed Postgres or Redis sibling. Connection string is injected as{' '}
              <code className="mono">&lt;NAME&gt;_URL</code> on this service.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setRequires([...requires, { kind: 'postgres', name: '' }])}
            className="text-(--color-accent) hover:underline text-xs shrink-0"
          >+ add</button>
        </div>
        {requires.length === 0 ? (
          <div className="text-xs text-(--color-muted)/70 italic">No managed siblings</div>
        ) : (
          <div className="space-y-2">
            {requires.map((row, i) => (
              <div key={i} className="grid grid-cols-[140px_1fr_auto] gap-2">
                <Select
                  value={row.kind}
                  onChange={(e) =>
                    setRequires(
                      requires.map((r, j) =>
                        i === j ? { ...r, kind: e.target.value as RequireRow['kind'] } : r,
                      ),
                    )
                  }
                >
                  <option value="postgres">postgres</option>
                  <option value="redis">redis</option>
                </Select>
                <Input
                  value={row.name}
                  onChange={(e) =>
                    setRequires(
                      requires.map((r, j) => (i === j ? { ...r, name: e.target.value } : r)),
                    )
                  }
                  placeholder="db"
                  pattern="^[a-z0-9][a-z0-9-]*[a-z0-9]?$"
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setRequires(requires.filter((_, j) => j !== i))}
                >×</Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && <Callout tone="error">{error}</Callout>}

      <div className="flex items-center gap-2 pt-2">
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Creating…' : 'Create service'}
        </Button>
        <Button type="button" variant="secondary" onClick={() => router.push('/')}>Cancel</Button>
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
