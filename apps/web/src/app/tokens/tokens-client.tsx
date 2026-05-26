'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Callout, Field, Input, Select } from '@/components/ui';

export interface TokenRow {
  id: string;
  kind: 'api' | 'rpc';
  name: string;
  prefix: string;
  service_id: string | null;
  tier: 'public' | 'internal';
  scopes: string[];
  rate_limit_per_min: number | null;
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
  created_at: string;
}

export interface ServiceRow {
  id: string;
  slug: string;
  name: string;
}

export function TokensClient({
  initialTokens,
  services,
}: {
  initialTokens: TokenRow[];
  services: ServiceRow[];
}) {
  const router = useRouter();
  const [tokens, setTokens] = useState(initialTokens);
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState<{ name: string; token: string } | null>(null);

  async function onRevoke(id: string) {
    if (!confirm('Revoke this token? Existing callers will start getting 401.')) return;
    const res = await fetch(`/api/tokens/${id}/revoke`, { method: 'POST', credentials: 'include' });
    if (res.ok) {
      setTokens(tokens.map((t) => (t.id === id ? { ...t, revoked_at: new Date().toISOString() } : t)));
    }
  }

  function onCreated(t: TokenRow, plain: string) {
    setTokens([t, ...tokens]);
    setRevealed({ name: t.name, token: plain });
    setCreating(false);
    router.refresh();
  }

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-semibold">Tokens</h1>
        <Button onClick={() => setCreating(true)} disabled={creating}>+ New token</Button>
      </div>

      {revealed && (
        <div className="mb-4 border border-(--color-accent) rounded p-4 bg-(--color-surface)">
          <div className="text-sm mb-1">
            Token <span className="mono">{revealed.name}</span> created — copy it now,
            it won&apos;t be shown again.
          </div>
          <div className="flex items-center gap-2">
            <code className="mono text-xs bg-(--color-bg) px-2 py-1.5 rounded border border-(--color-border) flex-1 break-all">
              {revealed.token}
            </code>
            <Button variant="secondary" onClick={() => navigator.clipboard.writeText(revealed.token)}>
              Copy
            </Button>
            <Button variant="secondary" onClick={() => setRevealed(null)}>Dismiss</Button>
          </div>
        </div>
      )}

      {creating && <CreateTokenForm services={services} onCreated={onCreated} onCancel={() => setCreating(false)} />}

      <div className="border border-(--color-border) rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-(--color-surface) text-(--color-muted)">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Name</th>
              <th className="text-left px-3 py-2 font-medium">Kind</th>
              <th className="text-left px-3 py-2 font-medium">Tier</th>
              <th className="text-left px-3 py-2 font-medium">Service</th>
              <th className="text-left px-3 py-2 font-medium">Prefix</th>
              <th className="text-left px-3 py-2 font-medium">Rate</th>
              <th className="text-left px-3 py-2 font-medium">Last used</th>
              <th className="text-left px-3 py-2 font-medium">Status</th>
              <th className="text-right px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {tokens.length === 0 ? (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-(--color-muted)">No tokens yet.</td></tr>
            ) : (
              tokens.map((t) => (
                <tr key={t.id} className="border-t border-(--color-border)">
                  <td className="px-3 py-2">{t.name}</td>
                  <td className="px-3 py-2 mono text-xs text-(--color-muted)">{t.kind}</td>
                  <td className="px-3 py-2 mono text-xs text-(--color-muted)">{t.tier}</td>
                  <td className="px-3 py-2 mono text-xs text-(--color-muted)">
                    {t.service_id ? services.find((s) => s.id === t.service_id)?.slug ?? '?' : '—'}
                  </td>
                  <td className="px-3 py-2 mono text-xs text-(--color-muted)">{t.prefix}…</td>
                  <td className="px-3 py-2 mono text-xs text-(--color-muted)">
                    {t.rate_limit_per_min ? `${t.rate_limit_per_min}/min` : '—'}
                  </td>
                  <td className="px-3 py-2 mono text-xs text-(--color-muted)">
                    {t.last_used_at ? new Date(t.last_used_at).toLocaleString() : '—'}
                  </td>
                  <td className="px-3 py-2">
                    {t.revoked_at
                      ? <span className="text-(--color-error) text-xs">revoked</span>
                      : <span className="text-(--color-healthy) text-xs">active</span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {!t.revoked_at && (
                      <Button variant="danger" onClick={() => onRevoke(t.id)}>Revoke</Button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function CreateTokenForm({
  services,
  onCreated,
  onCancel,
}: {
  services: ServiceRow[];
  onCreated: (t: TokenRow, plain: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'api' | 'rpc'>('rpc');
  const [tier, setTier] = useState<'public' | 'internal'>('public');
  const [serviceId, setServiceId] = useState<string>(services[0]?.id ?? '');
  const [rateLimit, setRateLimit] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = { name, kind, tier };
      if (kind === 'rpc' && serviceId) body.service_id = serviceId;
      if (rateLimit) body.rate_limit_per_min = Number(rateLimit);
      if (expiresAt) body.expires_at = new Date(expiresAt).toISOString();

      const res = await fetch('/api/tokens', {
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
      const { id, token, prefix } = await res.json();
      onCreated(
        {
          id, name, kind, tier, prefix,
          service_id: kind === 'rpc' ? serviceId : null,
          scopes: [],
          rate_limit_per_min: rateLimit ? Number(rateLimit) : null,
          expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
          revoked_at: null,
          last_used_at: null,
          created_at: new Date().toISOString(),
        },
        token,
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mb-4 border border-(--color-border) rounded p-4 space-y-3 bg-(--color-surface)">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} required /></Field>
        <Field label="Kind">
          <Select value={kind} onChange={(e) => setKind(e.target.value as 'api' | 'rpc')}>
            <option value="rpc">rpc</option>
            <option value="api">api</option>
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tier">
          <Select value={tier} onChange={(e) => setTier(e.target.value as 'public' | 'internal')}>
            <option value="public">public</option>
            <option value="internal">internal — debug_* / erigon_*</option>
          </Select>
        </Field>
        {kind === 'rpc' && (
          <Field label="Service">
            <Select value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
              {services.map((s) => <option key={s.id} value={s.id}>{s.slug}</option>)}
            </Select>
          </Field>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Rate limit" hint="requests / minute, optional">
          <Input type="number" value={rateLimit} onChange={(e) => setRateLimit(e.target.value)} placeholder="6000" />
        </Field>
        <Field label="Expires" hint="optional">
          <Input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
        </Field>
      </div>
      {error && <Callout tone="error">{error}</Callout>}
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={submitting}>{submitting ? 'Creating…' : 'Create token'}</Button>
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
