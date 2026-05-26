import { createDb, type HotboxDb, type MetricSource } from '@hotbox/db';
import { parseProm } from './parser.js';

const SCRAPE_INTERVAL_MS = 15_000;
const dbUrl = required('DATABASE_URL');
const hostId = required('HOST_ID');

interface ScrapeTarget {
  serviceId: string;
  source: MetricSource;
  url: string;
}

const db = createDb({ connectionString: dbUrl });

async function loadTargets(): Promise<ScrapeTarget[]> {
  // For v1 we hardcode the Eth node panels via convention: services with
  // template='eth-archive' get scraped at <slug>-erigon:6061 and
  // <slug>-lighthouse:5054. Generalising to template-declared panel sources
  // is a later refactor — keep it simple now.
  const services = await db
    .selectFrom('services')
    .select(['id', 'slug', 'template'])
    .where('host_id', '=', hostId)
    .where('archived_at', 'is', null)
    .where('template', '=', 'eth-archive')
    .execute();

  return services.flatMap((s) => [
    { serviceId: s.id, source: 'erigon' as const, url: `http://${s.slug}-erigon:6061/debug/metrics/prometheus` },
    { serviceId: s.id, source: 'lighthouse' as const, url: `http://${s.slug}-lighthouse:5054/metrics` },
  ]);
}

async function scrapeOnce(target: ScrapeTarget): Promise<void> {
  let body: string;
  try {
    const res = await fetch(target.url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      console.warn(`scrape ${target.url} -> HTTP ${res.status}`);
      return;
    }
    body = await res.text();
  } catch (err) {
    console.warn(`scrape ${target.url} failed`, (err as Error).message);
    return;
  }

  const samples = parseProm(body);
  if (samples.length === 0) return;

  const rows = samples.map((s) => ({
    service_id: target.serviceId,
    source: target.source,
    metric: s.metric,
    labels: s.labels,
    value: s.value,
  }));

  // Postgres has a parameter limit (65535). Chunk to be safe.
  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows.slice(i, i + 1000);
    try {
      await db.insertInto('node_metrics').values(chunk).execute();
    } catch (err) {
      console.error('node_metrics insert failed', err);
      break;
    }
  }
}

async function tick(): Promise<void> {
  const targets = await loadTargets();
  await Promise.all(targets.map((t) => scrapeOnce(t).catch((e) => console.error('scrape crashed', e))));
}

console.log(`hotbox-metrics-scraper starting, interval=${SCRAPE_INTERVAL_MS}ms`);
void tick();
const timer = setInterval(() => void tick(), SCRAPE_INTERVAL_MS);

function required(name: string): string {
  const v = process.env[name];
  if (!v) { console.error(`missing env var: ${name}`); process.exit(1); }
  return v;
}

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, async () => {
    clearInterval(timer);
    await (db as HotboxDb).destroy();
    process.exit(0);
  });
}
