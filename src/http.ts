import { createMcpExpressApp, requireBearerAuth } from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';
import type { Request, Response } from 'express';
import { createTokenVerifier } from './auth.js';
import type { Config } from './config.js';
import type { Pool } from './db.js';
import { log } from './log.js';
import { createBotbridgeHandler } from './mcp.js';
import { consumeRate } from './store.js';
import { VERSION } from './version.js';

function countToolCalls(body: unknown): number {
  const items = Array.isArray(body) ? body : [body];
  let count = 0;
  for (const item of items) {
    if (item && typeof item === 'object' && 'method' in item && item.method === 'tools/call') {
      count += 1;
    }
  }
  return count;
}

export function createApp(deps: { pool: Pool; config: Config }) {
  const { pool, config } = deps;
  const app = createMcpExpressApp({
    host: config.host,
    allowedHosts: config.allowedHosts,
    jsonLimit: '256kb',
  });

  app.get('/health', async (_req: Request, res: Response) => {
    try {
      await pool.query('SELECT 1');
      res.status(200).json({ ok: true, service: 'botbridge', version: VERSION });
    } catch (error) {
      log('error', 'health check failed', { error: error instanceof Error ? error.message : 'unknown' });
      res.status(503).json({ ok: false, service: 'botbridge', version: VERSION });
    }
  });

  app.get('/', (_req: Request, res: Response) => {
    res.status(200).json({
      service: 'botbridge',
      version: VERSION,
      mcp: '/mcp',
      health: '/health',
    });
  });

  const handler = createBotbridgeHandler({ pool, config });
  const nodeHandler = toNodeHandler(handler, {
    onerror: (error) => log('error', 'mcp handler failed', { error: error.message }),
  });
  const auth = requireBearerAuth({ verifier: createTokenVerifier(pool) });

  app.all('/mcp', auth, async (req: Request, res: Response) => {
    try {
      const calls = countToolCalls(req.body);
      const botId = req.auth?.clientId;
      if (calls > 0 && botId) {
        const decision = await consumeRate(pool, botId, config.rateLimitPerMinute, calls);
        if (!decision.ok) {
          res.set('Retry-After', String(decision.retryAfterSeconds));
          res.status(429).json({
            error: 'rate_limited',
            message: 'Too many tool calls for this bot token. Try again in a minute.',
          });
          return;
        }
      }
      await nodeHandler(req, res, req.body);
    } catch (error) {
      log('error', 'mcp request failed', { error: error instanceof Error ? error.message : 'unknown' });
      if (!res.headersSent) {
        res.status(500).json({ error: 'internal_error' });
      }
    }
  });

  return { app, handler };
}
