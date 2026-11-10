import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from './db.js';

const ADVISORY_LOCK = 842176;

export function migrationsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
}

export async function migrate(pool: Pool): Promise<string[]> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const files = (await readdir(migrationsDir())).filter((name) => name.endsWith('.sql')).sort();
  const applied: string[] = [];

  for (const file of files) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCK]);
      const existing = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [file]);
      if ((existing.rowCount ?? 0) === 0) {
        const sql = await readFile(join(migrationsDir(), file), 'utf8');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        applied.push(file);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  return applied;
}
