import type { Server } from 'node:http';
import { Client, type CallToolResult } from '@modelcontextprotocol/client';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { loadConfig, type Config } from '../src/config.js';
import { createPool, type Pool } from '../src/db.js';
import { createApp, type AppDeps } from '../src/http.js';
import { migrate } from '../src/migrate.js';
import { addBot } from '../src/store.js';

export function testConfig(overrides: Partial<Config> = {}): Config {
  return { ...loadConfig(), ...overrides };
}

export async function resetDb(pool: Pool): Promise<void> {
  await pool.query('TRUNCATE bots, api_keys, oauth_pending_clients RESTART IDENTITY CASCADE');
  await pool.query('UPDATE users SET oauth_split_clients = true');
}

export interface TestServer {
  baseUrl: string;
  pool: Pool;
  config: Config;
  close: () => Promise<void>;
}

export async function listenForTests(overrides: Partial<Config> = {}, extras: Partial<AppDeps> = {}): Promise<TestServer> {
  const config = testConfig(overrides);
  const pool = createPool(config);
  await migrate(pool);
  const { app, handler } = createApp({ pool, config, ...extras });
  const server: Server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', () => resolve());
    server.once('error', reject);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server did not bind a port');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    pool,
    config,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await handler.close();
      await pool.end();
    },
  };
}

export async function connectClient(
  url: string,
  token: string,
  name: string,
  options: { title?: string; headers?: Record<string, string>; path?: string } = {},
): Promise<Client> {
  const client = new Client({ name, version: '0.1.0', ...(options.title ? { title: options.title } : {}) });
  const transport = new StreamableHTTPClientTransport(new URL(`${url}${options.path ?? '/mcp'}`), {
    authProvider: { token: async () => token },
    requestInit: options.headers ? { headers: options.headers } : undefined,
  });
  await client.connect(transport);
  return client;
}

export function toolJson(result: CallToolResult): Record<string, unknown> {
  if (result.isError) {
    throw new Error(toolText(result));
  }
  const structured = result.structuredContent;
  if (structured && typeof structured === 'object' && !Array.isArray(structured)) {
    return structured as Record<string, unknown>;
  }
  return JSON.parse(toolText(result)) as Record<string, unknown>;
}

export function toolText(result: CallToolResult): string {
  const block = result.content.find((item) => item.type === 'text');
  if (!block || block.type !== 'text') return '';
  return block.text;
}

export async function issueBot(
  pool: Pool,
  name: string,
  options: { description?: string; capabilities?: string } = {},
): Promise<{ id: string; name: string; token: string }> {
  const created = await addBot(pool, {
    name,
    description: options.description,
    capabilities: options.capabilities,
  });
  return { id: created.bot.id, name: created.bot.name, token: created.token };
}
