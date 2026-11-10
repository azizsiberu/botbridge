import pg from 'pg';
import type { Config } from './config.js';

export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;

export function createPool(config: Pick<Config, 'databaseUrl'>): Pool {
  return new pg.Pool({
    connectionString: config.databaseUrl,
    max: 10,
    connectionTimeoutMillis: 10_000,
    options: '-c timezone=UTC',
  });
}
