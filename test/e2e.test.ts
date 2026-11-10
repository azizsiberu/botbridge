import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { start, type RunningServer } from '../src/serve.js';
import { testConfig } from './helpers.js';
import { resetDb } from './helpers.js';

const exec = promisify(execFile);

describe('compose-style end to end', () => {
  let running: RunningServer;

  beforeAll(async () => {
    running = await start(testConfig({ port: 0, host: '127.0.0.1' }));
    await resetDb(running.pool);
  });

  afterAll(async () => {
    await running.close();
  });

  it('registers two bots with the CLI and exchanges mail over MCP', async () => {
    const { stdout } = await exec(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/e2e.ts'], {
      env: {
        ...process.env,
        BOTBRIDGE_URL: `http://127.0.0.1:${running.port}`,
      },
    });
    expect(stdout).toMatch(/^ok thread=/);
  });
});
