'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';

const TABS = [
  { path: '', label: 'Overview' },
  { path: '/builds', label: 'Builds' },
  { path: '/variables', label: 'Variables' },
  { path: '/logs', label: 'Logs' },
  { path: '/settings', label: 'Settings' },
];

export function ServiceTabs({ serviceId }: { serviceId: string }) {
  const pathname = usePathname();
  const base = `/services/${serviceId}`;
  return (
    <nav className="flex gap-1 border-b border-(--color-border)">
      {TABS.map((t) => {
        const href = `${base}${t.path}`;
        const active = t.path === '' ? pathname === base : pathname.startsWith(href);
        return (
          <Link
            key={t.label}
            href={href}
            className={clsx(
              'px-3 py-2 text-sm -mb-px border-b-2',
              active
                ? 'border-(--color-accent) text-(--color-text) font-medium'
                : 'border-transparent text-(--color-muted) hover:text-(--color-text)',
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
