import Link from 'next/link';
import { apiFetch } from '@/lib/api';

export async function TopNav() {
  let role: string | null = null;
  try {
    const { user } = await apiFetch<{ user: { role: string } }>('/api/me');
    role = user.role;
  } catch {
    // unauthenticated — pages handle their own redirect
  }

  return (
    <nav className="border-b border-(--color-border) bg-(--color-surface)">
      <div className="max-w-6xl mx-auto px-6 py-3 flex items-center gap-6">
        <Link href="/" className="font-semibold tracking-tight">hotbox</Link>
        <Link href="/projects" className="text-(--color-muted) hover:text-(--color-text)">Projects</Link>
        <Link href="/" className="text-(--color-muted) hover:text-(--color-text)">All services</Link>
        <Link href="/tokens" className="text-(--color-muted) hover:text-(--color-text)">Tokens</Link>
        <Link href="/analytics" className="text-(--color-muted) hover:text-(--color-text)">Analytics</Link>
        <Link href="/audit" className="text-(--color-muted) hover:text-(--color-text)">Audit</Link>
        {role === 'admin' && (
          <Link href="/team" className="text-(--color-muted) hover:text-(--color-text)">Team</Link>
        )}
      </div>
    </nav>
  );
}
