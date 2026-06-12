'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Callout, Field, Input } from '@/components/ui';

export interface UserRow {
  id: string;
  email: string;
  role: string;
  disabled_at: string | null;
  created_at: string;
}

export interface InviteRow {
  id: string;
  note: string | null;
  role: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
  created_at: string;
  created_by_email: string | null;
  used_by_email: string | null;
}

function inviteStatus(i: InviteRow): { label: string; tone: 'muted' | 'healthy' | 'error' } {
  if (i.used_at) return { label: `used by ${i.used_by_email ?? '?'}`, tone: 'muted' };
  if (i.revoked_at) return { label: 'revoked', tone: 'error' };
  if (new Date(i.expires_at) < new Date()) return { label: 'expired', tone: 'error' };
  return { label: 'pending', tone: 'healthy' };
}

export function TeamClient({
  initialUsers,
  initialInvites,
  meId,
}: {
  initialUsers: UserRow[];
  initialInvites: InviteRow[];
  meId: string;
}) {
  const router = useRouter();
  const [users, setUsers] = useState(initialUsers);
  const [invites, setInvites] = useState(initialInvites);
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState<{ note: string | null; url: string } | null>(null);

  async function onToggleDisabled(u: UserRow) {
    const action = u.disabled_at ? 'enable' : 'disable';
    if (action === 'disable' && !confirm(`Disable ${u.email}? They will be signed out immediately.`)) return;
    const res = await fetch(`/api/users/${u.id}/${action}`, { method: 'POST', credentials: 'include' });
    if (res.ok) {
      setUsers(users.map((x) => (
        x.id === u.id ? { ...x, disabled_at: action === 'disable' ? new Date().toISOString() : null } : x
      )));
      router.refresh();
    }
  }

  async function onRevokeInvite(id: string) {
    if (!confirm('Revoke this invite? Its link will stop working.')) return;
    const res = await fetch(`/api/users/invites/${id}/revoke`, { method: 'POST', credentials: 'include' });
    if (res.ok) {
      setInvites(invites.map((i) => (i.id === id ? { ...i, revoked_at: new Date().toISOString() } : i)));
      router.refresh();
    }
  }

  function onCreated(invite: InviteRow, url: string) {
    setInvites([invite, ...invites]);
    setRevealed({ note: invite.note, url });
    setCreating(false);
    router.refresh();
  }

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-semibold">Team</h1>
        <Button onClick={() => setCreating(true)} disabled={creating}>+ New invite</Button>
      </div>

      {revealed && (
        <div className="mb-4 border border-(--color-accent) rounded p-4 bg-(--color-surface)">
          <div className="text-sm mb-1">
            Invite{revealed.note ? <> for <span className="mono">{revealed.note}</span></> : ''} created —
            copy the link now, it won&apos;t be shown again. Share it over a private channel.
          </div>
          <div className="flex items-center gap-2">
            <code className="mono text-xs bg-(--color-bg) px-2 py-1.5 rounded border border-(--color-border) flex-1 break-all">
              {revealed.url}
            </code>
            <Button variant="secondary" onClick={() => navigator.clipboard.writeText(revealed.url)}>
              Copy
            </Button>
            <Button variant="secondary" onClick={() => setRevealed(null)}>Dismiss</Button>
          </div>
        </div>
      )}

      {creating && <CreateInviteForm onCreated={onCreated} onCancel={() => setCreating(false)} />}

      <div className="border border-(--color-border) rounded-lg overflow-hidden mb-8">
        <table className="w-full text-sm">
          <thead className="bg-(--color-surface) text-(--color-muted)">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Email</th>
              <th className="text-left px-3 py-2 font-medium">Role</th>
              <th className="text-left px-3 py-2 font-medium">Joined</th>
              <th className="text-left px-3 py-2 font-medium">Status</th>
              <th className="text-right px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-(--color-border)">
                <td className="px-3 py-2">{u.email}</td>
                <td className="px-3 py-2 mono text-xs text-(--color-muted)">{u.role}</td>
                <td className="px-3 py-2 mono text-xs text-(--color-muted)">
                  {new Date(u.created_at).toLocaleDateString()}
                </td>
                <td className="px-3 py-2">
                  {u.disabled_at
                    ? <span className="text-(--color-error) text-xs">disabled</span>
                    : <span className="text-(--color-healthy) text-xs">active</span>}
                </td>
                <td className="px-3 py-2 text-right">
                  {u.id !== meId && (
                    u.disabled_at
                      ? <Button variant="secondary" onClick={() => onToggleDisabled(u)}>Enable</Button>
                      : <Button variant="danger" onClick={() => onToggleDisabled(u)}>Disable</Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="text-sm font-semibold mb-3">Invites</h2>
      <div className="border border-(--color-border) rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-(--color-surface) text-(--color-muted)">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Note</th>
              <th className="text-left px-3 py-2 font-medium">Created</th>
              <th className="text-left px-3 py-2 font-medium">Expires</th>
              <th className="text-left px-3 py-2 font-medium">Status</th>
              <th className="text-right px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {invites.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-(--color-muted)">No invites yet.</td></tr>
            ) : (
              invites.map((i) => {
                const status = inviteStatus(i);
                return (
                  <tr key={i.id} className="border-t border-(--color-border)">
                    <td className="px-3 py-2">{i.note ?? '—'}</td>
                    <td className="px-3 py-2 mono text-xs text-(--color-muted)">
                      {new Date(i.created_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 mono text-xs text-(--color-muted)">
                      {new Date(i.expires_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-xs ${
                        status.tone === 'healthy' ? 'text-(--color-healthy)'
                          : status.tone === 'error' ? 'text-(--color-error)'
                          : 'text-(--color-muted)'
                      }`}>
                        {status.label}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {!i.used_at && !i.revoked_at && new Date(i.expires_at) > new Date() && (
                        <Button variant="danger" onClick={() => onRevokeInvite(i.id)}>Revoke</Button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function CreateInviteForm({
  onCreated,
  onCancel,
}: {
  onCreated: (invite: InviteRow, url: string) => void;
  onCancel: () => void;
}) {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/users/invites', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(note ? { note } : {}),
        credentials: 'include',
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({ error: 'create failed' }));
        setError(payload.error ?? 'create failed');
        return;
      }
      const { id, url, expires_at } = await res.json();
      onCreated(
        {
          id,
          note: note || null,
          role: 'member',
          expires_at,
          used_at: null,
          revoked_at: null,
          created_at: new Date().toISOString(),
          created_by_email: null,
          used_by_email: null,
        },
        url,
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mb-4 border border-(--color-border) rounded p-4 space-y-3 bg-(--color-surface)">
      <Field label="Note" hint="who this invite is for, e.g. “alice” — optional">
        <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={80} />
      </Field>
      {error && <Callout tone="error">{error}</Callout>}
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={submitting}>{submitting ? 'Creating…' : 'Create invite'}</Button>
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
