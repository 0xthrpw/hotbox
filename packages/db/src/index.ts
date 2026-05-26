import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { Database } from './schema.js';

export * from './schema.js';

export interface CreateDbOptions {
  connectionString: string;
  poolMax?: number;
}

export function createDb({ connectionString, poolMax = 10 }: CreateDbOptions): Kysely<Database> {
  const pool = new pg.Pool({ connectionString, max: poolMax });
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  });
}

export type HotboxDb = Kysely<Database>;
