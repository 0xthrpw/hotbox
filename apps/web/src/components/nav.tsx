import Link from 'next/link';

export function TopNav() {
  return (
    <nav className="border-b border-(--color-border) bg-(--color-surface)">
      <div className="max-w-6xl mx-auto px-6 py-3 flex items-center gap-6">
        <Link href="/" className="font-semibold tracking-tight">hotbox</Link>
        <Link href="/" className="text-(--color-muted) hover:text-(--color-text)">Services</Link>
        <Link href="/tokens" className="text-(--color-muted) hover:text-(--color-text)">Tokens</Link>
        <Link href="/audit" className="text-(--color-muted) hover:text-(--color-text)">Audit</Link>
        <Link href="/settings" className="text-(--color-muted) hover:text-(--color-text)">Settings</Link>
      </div>
    </nav>
  );
}
