import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { corsHeaders, fetchClerkAuthorizationServerMetadata, generateClerkProtectedResourceMetadata } from '@clerk/mcp-tools/server';
import { createMcpExpressApp, requireBearerAuth } from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';
import express, { type Request, type Response } from 'express';
import { adminRouter } from './admin-routes.js';
import { createTokenVerifier } from './auth.js';
import type { Config } from './config.js';
import type { Pool } from './db.js';
import { log } from './log.js';
import { mcpRequestStore } from './mcp-request.js';
import { createBotbridgeHandler } from './mcp.js';
import { createAdminAuth, createClerkDirectory, createOAuthVerifier, type AdminAuth, type ClerkDirectory, type OAuthVerifier } from './identity.js';
import { consumeRate } from './store.js';
import { fileForLink, verifyLocalDownload } from './files.js';
import { contentDisposition, createStorage, type FileStorage } from './storage.js';
import { isUuid } from './text.js';
import { VERSION } from './version.js';

export interface AppDeps {
  pool: Pool;
  config: Config;
  adminAuth?: AdminAuth;
  oauth?: OAuthVerifier | null;
  directory?: ClerkDirectory | null;
  storage?: FileStorage;
}

/** JSON body limit: 1 MB, or enough for one base64 upload_file call at the configured file size cap. */
export function jsonLimitBytes(maxFileBytes: number): number {
  return Math.max(1024 * 1024, Math.ceil(maxFileBytes / 3) * 4 + 256 * 1024);
}

export function webDistDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'dist');
}

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

export function createApp(deps: AppDeps) {
  const { pool, config } = deps;
  const oauth = deps.oauth === undefined ? createOAuthVerifier(config) : deps.oauth;
  const adminAuth = deps.adminAuth ?? createAdminAuth(config);
  const directory = deps.directory === undefined ? createClerkDirectory(config) : deps.directory;
  const storage = deps.storage ?? createStorage(pool, config.files);
  const app = createMcpExpressApp({
    host: config.host,
    allowedHosts: config.allowedHosts,
    allowedOrigins: config.allowedHosts,
    jsonLimit: `${jsonLimitBytes(config.files.maxBytes)}b`,
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

  app.get('/api/public-config', (_req: Request, res: Response) => {
    res.json({
      version: VERSION,
      publicUrl: config.publicUrl,
      clerkPublishableKey: config.clerkPublishableKey,
      devAuth: config.dashboardDevAuth,
    });
  });

  mountOAuthMetadata(app, config);

  // Signed, short-lived download links for the db storage backend. get_file issues them per bot and file.
  app.get('/files/:id', async (req: Request, res: Response) => {
    const fileId = String(req.params.id ?? '');
    const botId = typeof req.query.b === 'string' ? req.query.b : '';
    const exp = typeof req.query.exp === 'string' ? req.query.exp : '';
    const sig = typeof req.query.sig === 'string' ? req.query.sig : '';
    res.set('Cache-Control', 'private, no-store');
    if (!isUuid(fileId) || !isUuid(botId) || !verifyLocalDownload(config, { fileId, botId, exp, sig })) {
      res.status(403).json({ error: 'invalid_or_expired_link' });
      return;
    }
    try {
      const found = await fileForLink({ pool, config, storage }, fileId.toLowerCase(), botId.toLowerCase());
      if (!found) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      res.set({
        'Content-Type': found.row.mime_type,
        'Content-Length': String(found.data.length),
        'Content-Disposition': contentDisposition(found.row.filename),
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      });
      res.status(200).end(found.data);
    } catch (error) {
      log('error', 'file download failed', { error: error instanceof Error ? error.message : 'unknown' });
      if (!res.headersSent) res.status(500).json({ error: 'internal_error' });
    }
  });

  app.use('/api/admin', adminRouter({ pool, config, adminAuth, directory }));
  app.use('/api', (error: unknown, _req: Request, res: Response, next: (error?: unknown) => void) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    log('error', 'admin api failed', { error: error instanceof Error ? error.message : 'unknown' });
    res.status(500).json({ error: 'internal_error' });
  });

  const handler = createBotbridgeHandler({ pool, config, storage });
  const nodeHandler = toNodeHandler(handler, {
    onerror: (error) => log('error', 'mcp handler failed', { error: error.message }),
  });
  const resourceMetadataUrl = config.publicUrl && config.clerkPublishableKey
    ? `${config.publicUrl}/.well-known/oauth-protected-resource/mcp`
    : undefined;
  const selectionUrl = config.publicUrl ? `${config.publicUrl}/oauth/choose` : null;
  const auth = requireBearerAuth({ verifier: createTokenVerifier(pool, oauth, selectionUrl), resourceMetadataUrl });

  // /mcp/b/<bot-name> picks the bot from the URL, like X-Botbridge-Bot, for clients that cannot set headers
  // or that all look identical (several Grok Bots on one Clerk account). The token audience stays /mcp.
  app.all(['/mcp', '/mcp/b/:bot'], (req, res, next) => {
    mcpRequestStore.run(req, () => next());
  }, auth, async (req: Request, res: Response) => {
    try {
      const sessionId = req.auth?.extra?.mcpSessionId;
      if (typeof sessionId === 'string' && sessionId) res.setHeader('mcp-session-id', sessionId);
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

  const indexFile = join(webDistDir(), 'index.html');
  if (existsSync(indexFile)) {
    app.use(express.static(webDistDir(), { index: false }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        next();
        return;
      }
      if (req.path.startsWith('/api') || req.path.startsWith('/mcp') || req.path.startsWith('/files/') || req.path === '/health' || req.path.startsWith('/.well-known')) {
        next();
        return;
      }
      res.sendFile(indexFile);
    });
  } else {
    app.get('/', (_req: Request, res: Response) => {
      res.status(200).json({
        service: 'botbridge',
        version: VERSION,
        mcp: '/mcp',
        health: '/health',
        dashboard: 'not built',
      });
    });
  }

  return { app, handler };
}

function mountOAuthMetadata(app: ReturnType<typeof createMcpExpressApp>, config: Config): void {
  if (!config.clerkPublishableKey || !config.publicUrl) return;
  const resourceUrl = `${config.publicUrl}/mcp`;
  const document = () =>
    generateClerkProtectedResourceMetadata({
      publishableKey: config.clerkPublishableKey!,
      resourceUrl,
      properties: {
        scopes_supported: ['profile', 'email'],
        bearer_methods_supported: ['header'],
      },
    });
  const send = (res: Response, body: unknown) => {
    res.set(corsHeaders);
    res.json(body);
  };
  app.get('/.well-known/oauth-protected-resource', (_req, res) => send(res, document()));
  app.get('/.well-known/oauth-protected-resource/mcp', (_req, res) => send(res, document()));
  // RFC 9728 path-inserted metadata for /mcp/b/<bot>. The resource stays /mcp, a prefix of the bot URL.
  app.get('/.well-known/oauth-protected-resource/mcp/b/:bot', (_req, res) => send(res, document()));
  app.get('/.well-known/oauth-authorization-server', async (_req, res) => {
    try {
      const metadata = await fetchClerkAuthorizationServerMetadata({ publishableKey: config.clerkPublishableKey! });
      send(res, metadata);
    } catch (error) {
      log('error', 'clerk metadata failed', { error: error instanceof Error ? error.message : 'unknown' });
      res.status(502).json({ error: 'clerk_metadata_unavailable' });
    }
  });
  app.options('/.well-known/oauth-protected-resource', (_req, res) => {
    res.set(corsHeaders).status(204).end();
  });
  app.options(['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-protected-resource/mcp/b/:bot'], (_req, res) => {
    res.set(corsHeaders).status(204).end();
  });
  app.options('/.well-known/oauth-authorization-server', (_req, res) => {
    res.set(corsHeaders).status(204).end();
  });
}
