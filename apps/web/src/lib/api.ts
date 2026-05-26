import { cookies, headers } from 'next/headers';

const API_BASE = process.env.HOTBOX_API_URL ?? 'http://127.0.0.1:3000';

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const cookieHeader = (await cookies())
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  const fwd = (await headers()).get('x-forwarded-for') ?? undefined;

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      cookie: cookieHeader,
      ...(fwd ? { 'x-forwarded-for': fwd } : {}),
      'content-type': init.body ? 'application/json' : 'application/json',
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`api ${path} -> ${res.status}: ${body}`);
  }
  return (await res.json()) as T;
}

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}
