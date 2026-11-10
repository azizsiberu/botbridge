import type { Server } from 'node:http';
import { loadConfig, type Config } from './config.js';
import { createPool, type Pool } from './db.js';
import { startDoorbellWorker } from './doorbell.js';
import { createApp } from './http.js';
import { log } from './log.js';
import { migrate } from './migrate.js';
import { reconcileTenancy } from './tenancy.js';

export interface RunningServer {
  server: Server;
  port: number;
  pool: Pool;
  close: () => Promise<void>;
}

export async function start(config: Config = loadConfig()): Promise<RunningServer> {
  const pool = createPool(config);
  log('info', 'connecting to postgres');
  const applied = await migrate(pool);
  if (applied.length > 0) log('info', 'applied migrations', { versions: applied });
  await reconcileTenancy(pool, config);

  const { app, handler } = createApp({ pool, config });
  const stopDoorbell = startDoorbellWorker(pool, config.secret);
  const server = app.listen(config.port, config.host);
  await new Promise<void>((resolve, reject) => {
    server.once('listening', () => resolve());
    server.once('error', reject);
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : config.port;
  log('info', 'botbridge listening', { host: config.host, port });

  return {
    server,
    port,
    pool,
    close: async () => {
      stopDoorbell();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await handler.close();
      await pool.end();
    },
  };
}
