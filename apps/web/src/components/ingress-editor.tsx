'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { Button, Callout, Field, Input } from '@/components/ui';

interface IngressState {
  hostname: string | null;
  public_port: number | null;
  auto_subdomain: boolean;
}

const fetcher = (url: string) => fetch(url, { credentials: 'include' }).then((r) => r.json());

/**
 * Inline editor for the three ingress fields on a service. Shows the
 * computed auto-subdomain URL when the box is checked and the operator
 * has set HOTBOX_AUTO_SUBDOMAIN_BASE. PATCH /api/services/:id/ingress
 * triggers a reconcile so Traefik picks up the new labels.
 */
export function IngressEditor({
  serviceId,
  serviceSlug,
  projectSlug,
  envSlug,
  initial,
}: {
  serviceId: string;
  serviceSlug: string;
  projectSlug: string;
  envSlug: string;
  initial: IngressState;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [hostname, setHostname] = useState(initial.hostname ?? '');
  const [publicPort, setPublicPort] = useState(
    initial.public_port === null ? '' : String(initial.public_port),
  );
  const [autoSubdomain, setAutoSubdomain] = useState(initial.auto_subdomain);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { data: metaData } = useSWR<{ auto_subdomain_base: string | null }>('/api/meta', fetcher);
  const base = metaData?.auto_subdomain_base ?? null;

  const computedAuto =
    autoSubdomain && base ? `${serviceSlug}-${envSlug}-${projectSlug}.${base}` : null;
  const liveAuto =
    initial.auto_subdomain && base
      ? `${serviceSlug}-${envSlug}-${projectSlug}.${base}`
      : null;

  async function onSave() {
    setError(null);
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        hostname: hostname.trim() === '' ? null : hostname.trim(),
        public_port: publicPort.trim() === '' ? null : Number(publicPort),
        auto_subdomain: autoSubdomain,
      };
      const res = await fetch(`/api/services/${serviceId}/ingress`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'include',
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({ error: 'update failed' }));
        setError(payload.error ?? 'update failed');
        return;
      }
      setEditing(false);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  if (!editing) {
    const noIngress = !initial.hostname && !liveAuto;
    return (
      <div className="border border-(--color-border) rounded p-3 space-y-1 text-sm">
        <div className="flex items-center justify-between">
          <div className="text-xs text-(--color-muted) uppercase tracking-wide">Ingress</div>
          <Button variant="secondary" onClick={() => setEditing(true)}>Edit</Button>
        </div>
        {noIngress ? (
          <div className="text-(--color-muted) italic">No ingress configured.</div>
        ) : (
          <div className="space-y-0.5 mono text-xs">
            {initial.hostname && (
              <div>
                <span className="text-(--color-muted)">custom: </span>
                <span>https://{initial.hostname}</span>
                {initial.public_port && (
                  <span className="text-(--color-muted)"> → :{initial.public_port}</span>
                )}
              </div>
            )}
            {liveAuto && (
              <div>
                <span className="text-(--color-muted)">auto: </span>
                <span>https://{liveAuto}</span>
              </div>
            )}
            {initial.auto_subdomain && !base && (
              <div className="text-(--color-warn)">
                auto_subdomain is on but HOTBOX_AUTO_SUBDOMAIN_BASE is unset on the api — no
                auto router is being emitted.
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="border border-(--color-border) rounded p-3 space-y-3 bg-(--color-surface)">
      <div className="text-xs text-(--color-muted) uppercase tracking-wide">Edit ingress</div>
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <Field label="Custom hostname" hint="leave blank to remove">
            <Input
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
              placeholder="api.example.com"
            />
          </Field>
        </div>
        <Field label="Public port">
          <Input
            type="number"
            value={publicPort}
            onChange={(e) => setPublicPort(e.target.value)}
            placeholder="8080"
          />
        </Field>
      </div>
      {base ? (
        <label className="flex items-start gap-2 text-xs text-(--color-muted)">
          <input
            type="checkbox"
            checked={autoSubdomain}
            onChange={(e) => setAutoSubdomain(e.target.checked)}
            className="mt-0.5"
          />
          <div>
            <div>Auto subdomain on <span className="mono">{base}</span></div>
            {computedAuto && (
              <div className="mt-1 mono text-(--color-accent)">https://{computedAuto}</div>
            )}
          </div>
        </label>
      ) : (
        <p className="text-xs text-(--color-muted)/70 italic">
          Auto subdomain disabled — operator hasn&apos;t set HOTBOX_AUTO_SUBDOMAIN_BASE.
        </p>
      )}
      {error && <Callout tone="error">{error}</Callout>}
      <div className="flex items-center gap-2">
        <Button onClick={onSave} disabled={submitting}>
          {submitting ? 'Saving…' : 'Save'}
        </Button>
        <Button variant="secondary" onClick={() => {
          setEditing(false);
          setHostname(initial.hostname ?? '');
          setPublicPort(initial.public_port === null ? '' : String(initial.public_port));
          setAutoSubdomain(initial.auto_subdomain);
          setError(null);
        }}>Cancel</Button>
      </div>
    </div>
  );
}
