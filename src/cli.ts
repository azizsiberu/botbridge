#!/usr/bin/env node
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { UserError } from './errors.js';
import { migrate } from './migrate.js';
import { operatorOwnerId, reconcileTenancy } from './tenancy.js';
import { start } from './serve.js';
import {
  addBot,
  clearWebhook,
  listBotsAdmin,
  revokeBot,
  setWebhook,
  updateBot,
} from './store.js';
import { decideRegistrationRequest, listRegistrationRequests } from './registration.js';
import { VERSION } from './version.js';

const USAGE = `botbridge ${VERSION}
The post office for AI bots.

Usage:
  botbridge serve
  botbridge migrate
  botbridge bot add <name> [--description <text>] [--capabilities a,b]
  botbridge bot list
  botbridge bot update <name> [--description <text>] [--capabilities a,b]
  botbridge bot revoke <name>
  botbridge bot webhook set <name> --url <url> --profile <generic|openbot|grok> [--secret <secret>]
  botbridge bot webhook clear <name>
  botbridge registration list [--all]
  botbridge registration approve <request-id> [--name <bot-name>]
  botbridge registration decline <request-id>

Environment:
  DATABASE_URL              Postgres connection string
  BOTBRIDGE_SECRET          Encrypts doorbell secrets. At least 16 characters.
  PORT                      Default 8787
  HOST                      Default 0.0.0.0
  ALLOWED_HOSTS             Comma-separated Host header allowlist
  RATE_LIMIT_PER_MINUTE     Tool calls per bot token. Default 120
  BOTBRIDGE_AUTO_REGISTER   1 lets every new client name mint a bot. Default 0:
                            only a client's first connection may, the rest wait
                            for approval (registration list/approve).
`;

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new UserError(`${name} needs a value`);
  }
  args.splice(index, 2);
  return value;
}

function requireFlag(args: string[], name: string): string {
  const value = flag(args, name);
  if (!value) throw new UserError(`${name} is required`);
  return value;
}

async function withDb<T>(fn: (pool: ReturnType<typeof createPool>, secret: string) => Promise<T>): Promise<T> {
  const config = loadConfig();
  const pool = createPool(config);
  try {
    await migrate(pool);
    await reconcileTenancy(pool, config);
    return await fn(pool, config.secret);
  } finally {
    await pool.end();
  }
}

async function botCommand(args: string[]): Promise<void> {
  const action = args.shift();
  if (action === 'add') {
    const name = args.shift();
    if (!name || name.startsWith('--')) throw new UserError('bot add needs a name');
    const description = flag(args, '--description') ?? '';
    const capabilities = flag(args, '--capabilities') ?? '';
    if (args.length > 0) throw new UserError(`Unexpected argument: ${args[0]}`);
    const created = await withDb(async (pool) => {
      const config = loadConfig();
      const ownerUserId = await operatorOwnerId(pool, config.legacyOwnerEmail);
      return addBot(pool, { name, description, capabilities, ownerUserId });
    });
    process.stdout.write(
      `created\nname: ${created.bot.name}\nid: ${created.bot.id}\ntoken: ${created.token}\n\nSave this token now. It cannot be shown again.\n`,
    );
    return;
  }

  if (action === 'list') {
    const bots = await withDb((pool) => listBotsAdmin(pool));
    if (bots.length === 0) {
      process.stdout.write('No bots yet.\n');
      return;
    }
    for (const bot of bots) {
      const webhook = bot.webhook_profile ? `${bot.webhook_profile} ${bot.webhook_url}` : 'none';
      const state = bot.revoked_at ? 'revoked' : 'active';
      process.stdout.write(
        `${bot.name}\t${state}\t${bot.id}\ttoken ${bot.token_prefix}…\twebhook ${webhook}\t${bot.description}\n`,
      );
    }
    return;
  }

  if (action === 'update') {
    const name = args.shift();
    if (!name) throw new UserError('bot update needs a name');
    const description = flag(args, '--description');
    const capabilities = flag(args, '--capabilities');
    if (description === undefined && capabilities === undefined) {
      throw new UserError('bot update needs --description or --capabilities');
    }
    if (args.length > 0) throw new UserError(`Unexpected argument: ${args[0]}`);
    const bot = await withDb((pool) =>
      updateBot(pool, name, {
        description,
        capabilities,
      }),
    );
    process.stdout.write(`updated ${bot.name}\n`);
    return;
  }

  if (action === 'revoke') {
    const name = args.shift();
    if (!name) throw new UserError('bot revoke needs a name');
    if (args.length > 0) throw new UserError(`Unexpected argument: ${args[0]}`);
    await withDb((pool) => revokeBot(pool, name));
    process.stdout.write(`revoked ${name.trim().toLowerCase()}\n`);
    return;
  }

  if (action === 'webhook') {
    const sub = args.shift();
    const name = args.shift();
    if (!name) throw new UserError('bot webhook needs a bot name');
    if (sub === 'clear') {
      if (args.length > 0) throw new UserError(`Unexpected argument: ${args[0]}`);
      await withDb((pool) => clearWebhook(pool, name));
      process.stdout.write(`webhook cleared for ${name.trim().toLowerCase()}\n`);
      return;
    }
    if (sub !== 'set') throw new UserError('Use: bot webhook set|clear <name>');
    const url = requireFlag(args, '--url');
    const profile = requireFlag(args, '--profile');
    const secret = flag(args, '--secret');
    if (args.length > 0) throw new UserError(`Unexpected argument: ${args[0]}`);
    const saved = await withDb((pool, master) => setWebhook(pool, master, { name, url, profile, secret }));
    if (saved.generated) {
      process.stdout.write(
        `webhook_secret: ${saved.secret}\n\nSave this secret now. It cannot be shown again.\nGive it to the receiver that verifies the doorbell.\n`,
      );
    } else {
      process.stdout.write(`webhook saved for ${name.trim().toLowerCase()} (${profile})\n`);
    }
    return;
  }

  throw new UserError('Unknown bot command. Run botbridge --help.');
}
async function registrationCommand(args: string[]): Promise<void> {
  const action = args.shift();
  if (action === 'list') {
    const all = args.includes('--all');
    const rest = args.filter((arg) => arg !== '--all');
    if (rest.length > 0) throw new UserError(`Unexpected argument: ${rest[0]}`);
    const rows = await withDb((pool) => listRegistrationRequests(pool, null, { status: all ? 'all' : 'pending' }));
    if (rows.length === 0) {
      process.stdout.write(all ? 'No registration requests.\n' : 'No pending registration requests.\n');
      return;
    }
    for (const row of rows) {
      process.stdout.write(
        `${row.id}\t${row.status}\t${row.requested_name}\towner ${row.owner.display_name}\t${row.kind} ${row.client}\ttries ${row.attempts}\tlast ${row.last_seen_at}${row.bot ? `\tbot ${row.bot.name}` : ''}\n`,
      );
    }
    return;
  }
  if (action === 'approve' || action === 'decline') {
    const id = args.shift();
    if (!id || id.startsWith('--')) throw new UserError(`registration ${action} needs a request id`);
    const name = action === 'approve' ? flag(args, '--name') : undefined;
    if (args.length > 0) throw new UserError(`Unexpected argument: ${args[0]}`);
    const result = await withDb((pool) => decideRegistrationRequest(pool, { id, userId: null, decision: action, name }));
    process.stdout.write(result.bot ? `approved, bot ${result.bot.name} (${result.bot.id})\n` : 'declined\n');
    return;
  }
  throw new UserError('Use: registration list|approve|decline. Run botbridge --help.');
}

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(USAGE);
    return;
  }
  if (command === 'serve') {
    if (rest.length > 0) throw new UserError(`Unexpected argument: ${rest[0]}`);
    const running = await start();
    const shutdown = async () => {
      await running.close();
      process.exit(0);
    };
    process.on('SIGINT', () => void shutdown());
    process.on('SIGTERM', () => void shutdown());
    return;
  }
  if (command === 'migrate') {
    if (rest.length > 0) throw new UserError(`Unexpected argument: ${rest[0]}`);
    const config = loadConfig();
    const pool = createPool(config);
    try {
      const applied = await migrate(pool);
      await reconcileTenancy(pool, config);
      process.stdout.write(applied.length === 0 ? 'migrations up to date\n' : `applied ${applied.join(', ')}\n`);
    } finally {
      await pool.end();
    }
    return;
  }
  if (command === 'bot') {
    await botCommand(rest);
    return;
  }
  if (command === 'registration') {
    await registrationCommand(rest);
    return;
  }
  throw new UserError(`Unknown command "${command}". Run botbridge --help.`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'botbridge failed';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
