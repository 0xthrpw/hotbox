'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function SignupClient({ token }: { token: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('passwords do not match');
      return;
    }
    if (password.length < 10) {
      setError('password must be at least 10 characters');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, email, password }),
        credentials: 'include',
      });
      if (!res.ok) {
        setError((await res.json().catch(() => ({ error: 'signup failed' }))).error ?? 'signup failed');
        return;
      }
      router.push('/');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center">
      <form onSubmit={onSubmit} className="w-80 border border-(--color-border) rounded-lg p-6 bg-(--color-surface)">
        <h1 className="text-lg font-semibold mb-1">hotbox</h1>
        <p className="text-xs text-(--color-muted) mb-4">You&apos;ve been invited — create your account.</p>
        <label className="block text-xs text-(--color-muted) mb-1">Email</label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full mb-3 px-2 py-1.5 bg-(--color-bg) border border-(--color-border) rounded text-sm"
        />
        <label className="block text-xs text-(--color-muted) mb-1">Password (min 10 characters)</label>
        <input
          type="password"
          required
          minLength={10}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full mb-3 px-2 py-1.5 bg-(--color-bg) border border-(--color-border) rounded text-sm"
        />
        <label className="block text-xs text-(--color-muted) mb-1">Confirm password</label>
        <input
          type="password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="w-full mb-4 px-2 py-1.5 bg-(--color-bg) border border-(--color-border) rounded text-sm"
        />
        {error && <div className="text-(--color-error) text-xs mb-3">{error}</div>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full px-3 py-2 rounded bg-(--color-accent) text-white text-sm disabled:opacity-50"
        >
          {submitting ? 'Creating account…' : 'Create account'}
        </button>
      </form>
    </main>
  );
}
