import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(here, '..', 'migrations');

async function main(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) { console.error('DATABASE_URL is required'); process.exit(1); }

  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();

  await client.query(`
    create table if not exists schema_migrations (
      version text primary key,
      applied_at timestamptz not null default now()
    );
  `);

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    const exists = await client.query('select 1 from schema_migrations where version = $1', [version]);
    if ((exists.rowCount ?? 0) > 0) {
      console.log(`skip ${version} (already applied)`);
      continue;
    }

    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    const upMarker = sql.indexOf('-- migrate:up');
    const downMarker = sql.indexOf('-- migrate:down');
    if (upMarker < 0) { console.error(`${file}: missing -- migrate:up marker`); process.exit(1); }
    const upStart = upMarker + '-- migrate:up'.length;
    const up = downMarker > 0 ? sql.slice(upStart, downMarker) : sql.slice(upStart);

    console.log(`applying ${version}…`);
    await client.query('begin');
    try {
      await client.query(up);
      await client.query('insert into schema_migrations(version) values($1)', [version]);
      await client.query('commit');
    } catch (err) {
      await client.query('rollback');
      throw err;
    }
  }

  await client.end();
  console.log('migrations done');
}

main().catch((err) => { console.error(err); process.exit(1); });
