import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '@modelcontextprotocol/client';
import { loadConfig } from '../src/config.js';
import { presignS3Url, S3Storage } from '../src/storage.js';
import { connectClient, issueBot, listenForTests, resetDb, testConfig, toolJson, toolText, type TestServer } from './helpers.js';

const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');

describe('SigV4 presigning', () => {
  it('matches the AWS documented example', () => {
    const url = presignS3Url({
      endpoint: 'https://s3.amazonaws.com',
      region: 'us-east-1',
      bucket: 'examplebucket',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      forcePathStyle: false,
      method: 'GET',
      key: 'test.txt',
      expiresSeconds: 86400,
      now: new Date('2013-05-24T00:00:00Z'),
    });
    expect(url).toBe(
      'https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
    );
  });

  it('requires bucket and keys when S3 storage is selected', () => {
    const base = { DATABASE_URL: 'postgres://x', BOTBRIDGE_SECRET: 'a-test-secret-long-enough' };
    expect(() => loadConfig({ ...base, BOTBRIDGE_STORAGE: 's3' })).toThrow(/BOTBRIDGE_S3_ENDPOINT/);
    const config = loadConfig({
      ...base,
      BOTBRIDGE_STORAGE: 's3',
      BOTBRIDGE_S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com/',
      BOTBRIDGE_S3_BUCKET: 'bridge',
      BOTBRIDGE_S3_ACCESS_KEY_ID: 'id',
      BOTBRIDGE_S3_SECRET_ACCESS_KEY: 'secret',
      BOTBRIDGE_FILE_ALLOWED_TYPES: 'image/*, application/pdf',
    });
    expect(config.files.s3?.endpoint).toBe('https://acct.r2.cloudflarestorage.com');
    expect(config.files.s3?.region).toBe('auto');
    expect(config.files.allowedTypes).toEqual(['image/*', 'application/pdf']);
    expect(loadConfig(base).files.storage).toBe('db');
  });
});

describe('file attachments on the db backend', () => {
  let app: TestServer;
  const clients: Client[] = [];

  beforeAll(async () => {
    app = await listenForTests({ files: { ...testConfig().files, maxBytes: 64, allowedTypes: ['text/plain', 'image/*'] } });
  });

  beforeEach(async () => {
    await resetDb(app.pool);
  });

  afterAll(async () => {
    await app.close();
  });

  async function connect(token: string, name: string): Promise<Client> {
    const client = await connectClient(app.baseUrl, token, name);
    clients.push(client);
    return client;
  }

  async function closeAll(): Promise<void> {
    while (clients.length > 0) await clients.pop()?.close();
  }

  it('attaches a file to a DM and lets only the sender and recipient fetch it', async () => {
    const ajeg = await issueBot(app.pool, 'ajeg');
    const aziz = await issueBot(app.pool, 'aziz');
    const cara = await issueBot(app.pool, 'cara');
    const ajegClient = await connect(ajeg.token, 'ajeg');
    const azizClient = await connect(aziz.token, 'aziz');
    const caraClient = await connect(cara.token, 'cara');
    try {
      const uploaded = toolJson(
        await ajegClient.callTool({ name: 'upload_file', arguments: { filename: '../stok/serpong.txt', mime_type: 'text/plain; charset=utf-8', content_base64: b64('sku,qty\nkohaku,1\n') } }),
      );
      const file = uploaded.file as { id: string; filename: string; mime_type: string; size: number; sha256: string };
      expect(file.filename).toBe('serpong.txt');
      expect(file.mime_type).toBe('text/plain');
      expect(file.size).toBe(17);
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);

      const early = await azizClient.callTool({ name: 'get_file', arguments: { file_id: file.id } });
      expect(early.isError).toBe(true);

      const sent = toolJson(
        await ajegClient.callTool({ name: 'send_message', arguments: { to: 'aziz', text: '@aziz stock for Serpong attached', attachments: [file.id] } }),
      );
      expect(sent.mentioned).toBe(true);
      expect((sent.attachments as Array<{ id: string }>)[0]?.id).toBe(file.id);

      const inbox = toolJson(await azizClient.callTool({ name: 'read_inbox', arguments: {} }));
      const message = (inbox.messages as Array<{ attachments: Array<{ id: string; filename: string }> }>)[0];
      expect(message?.attachments).toEqual([{ id: file.id, filename: 'serpong.txt', mime_type: 'text/plain', size: 17 }]);

      const content = toolJson(await azizClient.callTool({ name: 'get_file', arguments: { file_id: file.id, as: 'content' } }));
      expect(Buffer.from(String(content.content_base64), 'base64').toString('utf8')).toBe('sku,qty\nkohaku,1\n');

      const link = toolJson(await azizClient.callTool({ name: 'get_file', arguments: { file_id: file.id } }));
      const path = String(link.url);
      expect(path.startsWith(`/files/${file.id}?`)).toBe(true);
      const download = await fetch(`${app.baseUrl}${path}`);
      expect(download.status).toBe(200);
      expect(download.headers.get('content-disposition')).toContain('serpong.txt');
      expect(download.headers.get('x-content-type-options')).toBe('nosniff');
      expect(await download.text()).toBe('sku,qty\nkohaku,1\n');

      const tampered = await fetch(`${app.baseUrl}${path.replace(/sig=[^&]+/, 'sig=AAAA')}`);
      expect(tampered.status).toBe(403);
      const forged = await fetch(`${app.baseUrl}${path.replace(aziz.id, cara.id)}`);
      expect(forged.status).toBe(403);

      const stranger = await caraClient.callTool({ name: 'get_file', arguments: { file_id: file.id } });
      expect(stranger.isError).toBe(true);
      expect(toolText(stranger)).toContain('File not found');
      const reuse = await caraClient.callTool({ name: 'send_message', arguments: { to: 'ajeg', text: 'forward', attachments: [file.id] } });
      expect(reuse.isError).toBe(true);

      const audit = await app.pool.query<{ action: string; detail: Record<string, unknown> }>(
        `SELECT action, detail FROM audit_log WHERE resource_type = 'file' ORDER BY id`,
      );
      expect(audit.rows.map((row) => row.action)).toEqual(['file.uploaded', 'file.downloaded', 'file.download_url', 'file.downloaded']);
      expect(JSON.stringify(audit.rows)).not.toContain('kohaku');
    } finally {
      await closeAll();
    }
  });

  it('shares room attachments with current members only, and enforces size and type limits', async () => {
    const ajeg = await issueBot(app.pool, 'ajeg');
    const aziz = await issueBot(app.pool, 'aziz');
    const ajegClient = await connect(ajeg.token, 'ajeg');
    const azizClient = await connect(aziz.token, 'aziz');
    try {
      const tooBig = await ajegClient.callTool({ name: 'upload_file', arguments: { filename: 'big.txt', mime_type: 'text/plain', content_base64: b64('x'.repeat(65)) } });
      expect(toolText(tooBig)).toContain('64 byte limit');
      const badType = await ajegClient.callTool({ name: 'upload_file', arguments: { filename: 'a.html', mime_type: 'text/html', content_base64: b64('<b>') } });
      expect(toolText(badType)).toContain('not allowed');
      const noDirect = await ajegClient.callTool({ name: 'create_upload', arguments: { filename: 'a.png', mime_type: 'image/png', size: 10 } });
      expect(toolText(noDirect)).toContain('upload_file');

      const file = toolJson(await ajegClient.callTool({ name: 'upload_file', arguments: { filename: 'denah.png', mime_type: 'image/png', content_base64: b64('png-bytes') } }))
        .file as { id: string };
      toolJson(await ajegClient.callTool({ name: 'create_room', arguments: { name: 'gudang', members: ['aziz'] } }));
      const posted = toolJson(await ajegClient.callTool({ name: 'post_room', arguments: { room: 'gudang', text: 'Layout gudang', attachments: [file.id] } }));
      expect((posted.post as { attachments: unknown[] }).attachments).toHaveLength(1);

      const read = toolJson(await azizClient.callTool({ name: 'read_room', arguments: { room: 'gudang' } }));
      const attachment = (read.posts as Array<{ attachments: Array<{ id: string }> }>)[0]?.attachments[0];
      expect(attachment?.id).toBe(file.id);
      toolJson(await azizClient.callTool({ name: 'get_file', arguments: { file_id: file.id, as: 'content' } }));
      const link = String(toolJson(await azizClient.callTool({ name: 'get_file', arguments: { file_id: file.id } })).url);

      toolJson(await azizClient.callTool({ name: 'leave_room', arguments: { room: 'gudang' } }));
      const after = await azizClient.callTool({ name: 'get_file', arguments: { file_id: file.id } });
      expect(after.isError).toBe(true);
      const stale = await fetch(`${app.baseUrl}${link}`);
      expect(stale.status).toBe(404);
    } finally {
      await closeAll();
    }
  });
});

describe('file attachments on S3-compatible storage', () => {
  let app: TestServer;
  let fake: Server;
  let endpoint = '';
  const objects = new Map<string, { body: Buffer; type: string }>();
  const clients: Client[] = [];

  beforeAll(async () => {
    fake = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://fake');
      if (!url.searchParams.get('X-Amz-Signature')) {
        res.statusCode = 403;
        res.end();
        return;
      }
      const key = url.pathname;
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const found = objects.get(key);
        if (req.method === 'PUT') {
          objects.set(key, { body: Buffer.concat(chunks), type: String(req.headers['content-type'] ?? '') });
          res.statusCode = 200;
          res.end();
        } else if (req.method === 'HEAD' || req.method === 'GET') {
          if (!found) {
            res.statusCode = 404;
            res.end();
            return;
          }
          res.setHeader('content-length', String(found.body.length));
          const disposition = url.searchParams.get('response-content-disposition');
          if (disposition) res.setHeader('content-disposition', disposition);
          res.statusCode = 200;
          res.end(req.method === 'GET' ? found.body : undefined);
        } else if (req.method === 'DELETE') {
          objects.delete(key);
          res.statusCode = 204;
          res.end();
        } else {
          res.statusCode = 405;
          res.end();
        }
      });
    });
    await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
    const address = fake.address();
    if (!address || typeof address === 'string') throw new Error('fake S3 did not bind');
    endpoint = `http://127.0.0.1:${address.port}`;
    const s3 = { endpoint, region: 'auto', bucket: 'bridge', accessKeyId: 'id', secretAccessKey: 'secret', forcePathStyle: true, prefix: 'bb/' };
    app = await listenForTests(
      { files: { ...testConfig().files, storage: 's3', maxBytes: 32, s3 } },
      { storage: new S3Storage(s3), adminAuth: { async verifySession(token) { return token === 'workspace-test' ? { userId: 's3_user',email:'s3@example.com',orgRoles:[] } : null; } } },
    );
  });

  beforeEach(async () => {
    await resetDb(app.pool);
    objects.clear();
  });

  afterAll(async () => {
    while (clients.length > 0) await clients.pop()?.close();
    await new Promise<void>((resolve, reject) => fake.close((error) => (error ? reject(error) : resolve())));
    await app.close();
  });

  it('completes a browser workspace upload and issues an authorized download', async () => {
    async function call<T>(path: string, body?: unknown) {
      const response = await fetch(app.baseUrl + path, {
        method: body ? 'POST' : 'GET',
        headers: { authorization: 'Bearer workspace-test', 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      expect(response.ok, await response.clone().text()).toBe(true);
      return (await response.json()) as T;
    }
    const { bot } = await call<{bot:{id:string}}>('/api/admin/bots', { name: 'file-agent' });
    const root = '/api/workspace/bots/' + bot.id;
    expect((await call<{direct:boolean}>(root + '/uploads')).direct).toBe(true);
    const { file, upload } = await call<{file:{id:string};upload:{url:string;headers:Record<string,string>}}>(root + '/uploads', { filename: 'note.txt', mimeType: 'text/plain', size: 5 });
    expect((await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: 'hello' })).ok).toBe(true);
    expect((await call<{status:string}>(root + '/uploads/' + file.id + '/complete', {})).status).toBe('ready');
    const { url } = await call<{url:string}>(root + '/files/' + file.id);
    expect(await (await fetch(url)).text()).toBe('hello');
  });
  it('uploads through a presigned URL, completes, and downloads through a presigned URL', async () => {
    const ajeg = await issueBot(app.pool, 'ajeg');
    const aziz = await issueBot(app.pool, 'aziz');
    const ajegClient = await connectClient(app.baseUrl, ajeg.token, 'ajeg');
    const azizClient = await connectClient(app.baseUrl, aziz.token, 'aziz');
    clients.push(ajegClient, azizClient);

    const started = toolJson(await ajegClient.callTool({ name: 'create_upload', arguments: { filename: 'promo kinami.pdf', mime_type: 'application/pdf', size: 9 } }));
    const pending = started.file as { id: string; status: string };
    const upload = started.upload as { url: string; method: string; headers: Record<string, string> };
    expect(pending.status).toBe('pending');
    expect(upload.url.startsWith(`${endpoint}/bridge/bb/files/${pending.id}?`)).toBe(true);
    expect(upload.url).not.toContain('secret');

    const notYet = await ajegClient.callTool({ name: 'complete_upload', arguments: { file_id: pending.id } });
    expect(toolText(notYet)).toContain('No bytes');
    const unattached = await ajegClient.callTool({ name: 'send_message', arguments: { to: 'aziz', text: 'x', attachments: [pending.id] } });
    expect(toolText(unattached)).toContain('complete_upload');

    const put = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: 'pdf-bytes' });
    expect(put.status).toBe(200);
    const done = toolJson(await ajegClient.callTool({ name: 'complete_upload', arguments: { file_id: pending.id } }));
    expect((done.file as { status: string; size: number }).status).toBe('ready');

    toolJson(await ajegClient.callTool({ name: 'send_message', arguments: { to: 'aziz', text: 'Promo PDF', attachments: [pending.id] } }));
    const link = toolJson(await azizClient.callTool({ name: 'get_file', arguments: { file_id: pending.id } }));
    const url = String(link.url);
    expect(url).toContain('response-content-disposition=');
    const download = await fetch(url);
    expect(await download.text()).toBe('pdf-bytes');
    expect(download.headers.get('content-disposition')).toContain('promo kinami.pdf');

    const inline = toolJson(await ajegClient.callTool({ name: 'upload_file', arguments: { filename: 'n.txt', mime_type: 'text/plain', content_base64: b64('hello') } }));
    const inlineId = (inline.file as { id: string }).id;
    expect(objects.get(`/bridge/bb/files/${inlineId}`)?.body.toString()).toBe('hello');

    const big = toolJson(await ajegClient.callTool({ name: 'create_upload', arguments: { filename: 'big.pdf', mime_type: 'application/pdf', size: 10 } }));
    await fetch((big.upload as { url: string }).url, { method: 'PUT', body: 'y'.repeat(40) });
    const rejected = await ajegClient.callTool({ name: 'complete_upload', arguments: { file_id: (big.file as { id: string }).id } });
    expect(toolText(rejected)).toContain('It was deleted');
    expect(objects.has(`/bridge/bb/files/${(big.file as { id: string }).id}`)).toBe(false);
  });
});
