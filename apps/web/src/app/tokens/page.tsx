import { redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { TopNav } from '@/components/nav';
import { TokensClient, type TokenRow, type ServiceRow } from './tokens-client';

export default async function TokensPage() {
  let tokens: TokenRow[];
  let services: ServiceRow[];
  try {
    [{ tokens }, { services }] = await Promise.all([
      apiFetch<{ tokens: TokenRow[] }>('/api/tokens'),
      apiFetch<{ services: ServiceRow[] }>('/api/services'),
    ]);
  } catch (err) {
    if ((err as Error).message.includes('401')) redirect('/login');
    throw err;
  }

  return (
    <>
      <TopNav />
      <main className="max-w-6xl mx-auto px-6 py-8">
        <TokensClient initialTokens={tokens} services={services} />
      </main>
    </>
  );
}
