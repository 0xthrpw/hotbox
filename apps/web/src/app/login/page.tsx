'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
        credentials: 'include',
      });
      if (!res.ok) {
        setError((await res.json().catch(() => ({ error: 'login failed' }))).error ?? 'login failed');
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
        <h1 className="text-lg font-semibold mb-4">hotbox</h1>
        <label className="block text-xs text-(--color-muted) mb-1">Email</label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full mb-3 px-2 py-1.5 bg-(--color-bg) border border-(--color-border) rounded text-sm"
        />
        <label className="block text-xs text-(--color-muted) mb-1">Password</label>
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full mb-4 px-2 py-1.5 bg-(--color-bg) border border-(--color-border) rounded text-sm"
        />
        {error && <div className="text-(--color-error) text-xs mb-3">{error}</div>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full px-3 py-2 rounded bg-(--color-accent) text-white text-sm disabled:opacity-50"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
