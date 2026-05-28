'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { Button, Callout, Field, Input } from '@/components/ui';

export type VariableScope = 'project' | 'environment' | 'service';

export interface VariableRow {
  id: string;
  scope: VariableScope;
  key: string;
  value: string | null;       // null for secrets
  is_secret: boolean;
  created_at: string;
  updated_at: string;
}

interface ListResponse { variables: VariableRow[] }
interface MutationResponse {
  variable?: VariableRow;
  affected_service_ids?: string[];
  ok?: true;
}

const fetcher = (url: string) => fetch(url, { credentials: 'include' }).then((r) => r.json());

function scopePath(scope: VariableScope, scopeId: string): string {
  if (scope === 'project') return `/api/projects/${scopeId}/variables`;
  if (scope === 'environment') return `/api/environments/${scopeId}/variables`;
  return `/api/services/${scopeId}/variables`;
}

export function VariablesPanel({
  scope,
  scopeId,
  title,
}: {
  scope: VariableScope;
  scopeId: string;
  title?: string;
}) {
  const path = scopePath(scope, scopeId);
  const { data, mutate, isLoading } = useSWR<ListResponse>(path, fetcher);
  const [adding, setAdding] = useState(false);
  const [affected, setAffected] = useState<string[] | null>(null);
  const [redeploying, setRedeploying] = useState(false);

  async function onRedeployAffected() {
    if (!affected || affected.length === 0) return;
    setRedeploying(true);
    try {
      await Promise.all(
        affected.map((sid) =>
          fetch(`/api/services/${sid}/deployments`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
            credentials: 'include',
          }),
        ),
      );
      setAffected(null);
    } finally {
      setRedeploying(false);
    }
  }

  const rows = data?.variables ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">{title ?? 'Variables'}</div>
        <Button
          variant="secondary"
          onClick={() => setAdding((v) => !v)}
          disabled={adding}
        >
          + Add variable
        </Button>
      </div>

      {affected !== null && affected.length > 0 && (
        <Callout tone="warn">
          <div className="flex items-center justify-between gap-3">
            <div>
              {affected.length} {affected.length === 1 ? 'service' : 'services'} would pick this up on
              redeploy.
            </div>
            <Button onClick={onRedeployAffected} disabled={redeploying}>
              {redeploying ? 'Redeploying…' : `Redeploy ${affected.length}`}
            </Button>
          </div>
        </Callout>
      )}

      {adding && (
        <AddVariableForm
          path={path}
          onCreated={async (res) => {
            setAdding(false);
            setAffected(res.affected_service_ids ?? []);
            await mutate();
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      {isLoading ? (
        <div className="text-xs text-(--color-muted) italic">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-xs text-(--color-muted) italic">No variables at this scope.</div>
      ) : (
        <div className="border border-(--color-border) rounded overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-(--color-surface) text-(--color-muted)">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Key</th>
                <th className="text-left px-3 py-2 font-medium">Value</th>
                <th className="text-right px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <VariableRowEditor
                  key={row.id}
                  row={row}
                  path={path}
                  onMutated={async (res) => {
                    setAffected(res.affected_service_ids ?? []);
                    await mutate();
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AddVariableForm({
  path,
  onCreated,
  onCancel,
}: {
  path: string;
  onCreated: (res: MutationResponse) => void;
  onCancel: () => void;
}) {
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [isSecret, setIsSecret] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key, value, is_secret: isSecret }),
        credentials: 'include',
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({ error: 'create failed' }));
        setError(payload.error ?? 'create failed');
        return;
      }
      onCreated(await res.json());
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="border border-(--color-border) rounded p-3 space-y-3 bg-(--color-surface)"
    >
      <div className="grid grid-cols-[1fr_2fr] gap-3">
        <Field label="Key" hint="UPPER_SNAKE">
          <Input
            value={key}
            onChange={(e) => setKey(e.target.value.toUpperCase())}
            placeholder="DATABASE_URL"
            pattern="^[A-Z_][A-Z0-9_]*$"
            required
          />
        </Field>
        <Field label={isSecret ? 'Value (encrypted at rest)' : 'Value'}>
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            type={isSecret ? 'password' : 'text'}
            required
          />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-xs text-(--color-muted)">
        <input
          type="checkbox"
          checked={isSecret}
          onChange={(e) => setIsSecret(e.target.checked)}
        />
        Secret — value never readable again from the UI; only the running container sees it
      </label>
      {error && <Callout tone="error">{error}</Callout>}
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Add'}</Button>
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

function VariableRowEditor({
  row,
  path,
  onMutated,
}: {
  row: VariableRow;
  path: string;
  onMutated: (res: MutationResponse) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(row.value ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Reset the local edit buffer when the underlying row changes (e.g.
  // someone else updates this variable in another tab and SWR revalidates).
  useEffect(() => { setValue(row.value ?? ''); }, [row.value]);

  async function onSave() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`${path}/${row.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value }),
        credentials: 'include',
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({ error: 'update failed' }));
        setError(payload.error ?? 'update failed');
        return;
      }
      onMutated(await res.json());
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!confirm(`Delete ${row.key}?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`${path}/${row.id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) return;
      onMutated(await res.json());
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className="border-t border-(--color-border)">
      <td className="px-3 py-2 mono text-xs">
        {row.key}
        {row.is_secret && (
          <span className="ml-2 text-(--color-warn) text-[10px] uppercase tracking-wider">secret</span>
        )}
      </td>
      <td className="px-3 py-2 mono text-xs">
        {editing ? (
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            type={row.is_secret ? 'password' : 'text'}
            autoFocus
          />
        ) : row.is_secret ? (
          <span className="text-(--color-muted)">••••••••</span>
        ) : (
          <span>{row.value}</span>
        )}
        {error && <div className="text-(--color-error) text-xs mt-1">{error}</div>}
      </td>
      <td className="px-3 py-2 text-right whitespace-nowrap">
        {editing ? (
          <>
            <Button onClick={onSave} disabled={busy}>{busy ? '…' : 'Save'}</Button>
            <Button
              variant="secondary"
              onClick={() => { setEditing(false); setValue(row.value ?? ''); setError(null); }}
              className="ml-1"
            >Cancel</Button>
          </>
        ) : (
          <>
            <Button
              variant="secondary"
              onClick={() => setEditing(true)}
              disabled={busy}
              title={row.is_secret ? 'Enter a new value to rotate the secret' : 'Edit value'}
            >
              {row.is_secret ? 'Rotate' : 'Edit'}
            </Button>
            <Button variant="danger" onClick={onDelete} disabled={busy} className="ml-1">×</Button>
          </>
        )}
      </td>
    </tr>
  );
}
