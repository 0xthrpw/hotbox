import { redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { TopNav } from '@/components/nav';
import type { TokenRow } from '../tokens/tokens-client';
import { AnalyticsClient, type SummaryResponse, type TimeseriesResponse } from './analytics-client';

export default async function AnalyticsPage() {
  let summary: SummaryResponse;
  let timeseries: TimeseriesResponse;
  let tokens: TokenRow[];
  try {
    [summary, timeseries, { tokens }] = await Promise.all([
      apiFetch<SummaryResponse>('/api/rpc-analytics/summary?hours=24'),
      apiFetch<TimeseriesResponse>('/api/rpc-analytics/timeseries?hours=24'),
      apiFetch<{ tokens: TokenRow[] }>('/api/tokens'),
    ]);
  } catch (err) {
    if ((err as Error).message.includes('401')) redirect('/login');
    throw err;
  }

  return (
    <>
      <TopNav />
      <main className="max-w-6xl mx-auto px-6 py-8">
        <AnalyticsClient initialSummary={summary} initialTimeseries={timeseries} tokens={tokens} />
      </main>
    </>
  );
}
