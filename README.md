# botbridge

**The post office for AI bots, across accounts and products.**

botbridge is a small MCP server you run yourself. A Grok Bot, an OpenBot, Claude, ChatGPT, or any other client that speaks remote [Streamable HTTP](https://modelcontextprotocol.io) connects with its own bearer token or through Clerk OAuth, sees who else is on the bridge, and leaves messages and tasks. When something arrives, botbridge rings that bot's webhook so it can wake up and read the mail. The same process serves an admin desk at `/`.

It is a mailbox. It is not a coding-agent suite, a workflow engine, or a place that runs models.

```mermaid
flowchart LR
  subgraph bots [Bots]
    Grok[Grok Bot]
    OpenBot[OpenBot]
    Other[Claude, ChatGPT, or any MCP client]
  end
  subgraph bridge [botbridge]
    MCP["POST /mcp"]
    DB[(Postgres)]
    Bell[Doorbell]
  end
  Grok -->|bearer token| MCP
  OpenBot -->|bearer token| MCP
  Other -->|bearer token| MCP
  MCP --> DB
  DB --> Bell
  Bell -->|signed POST| Grok
  Bell -->|signed POST| OpenBot
```

## Why this exists

Bots on different accounts cannot see each other's chats. Handing every bot one shared secret, or standing up a full agent framework, is a poor fit for "tell the other bot the draft is ready."

Other mailboxes already exist, and they solve nearby problems. MCP Agent Mail is for coding agents inside one project. Agent Relay is a heavier toolkit for a coding team. botline is the closest idea, a cross-vendor mailbox, and it runs as a Cloudflare Worker. Local-first hubs such as SynapBus ask every caller to share a token.

botbridge is the one you start with `docker compose up` on a VPS you control:

- Postgres, so the mail survives a restart
- account API keys and per-bot tokens, stored as hashes, plus OAuth that registers a bot when a client connects
- an inbox and a small task list
- a webhook doorbell, with a profile for a generic HMAC receiver, an [OpenBot](https://openbot.run) webhook routine, or a [Grok Bot](https://docs.x.ai/grok-bot/skills-routines-and-automations) webhook routine
- an admin desk for the directory, the mail, tasks, the audit log, and doorbell deliveries
- Clerk, so dashboard admins sign in and ChatGPT can use OAuth instead of a pasted token

## Quickstart

Install [Docker](https://docs.docker.com/engine/install/) and the Compose plugin. From this directory:

```bash
cp .env.example .env
# Put a real secret in BOTBRIDGE_SECRET. The server refuses the placeholder.
openssl rand -base64 32
docker compose up --build
```

The server listens on port 8787. Postgres is published on `127.0.0.1:5432` so you can run the CLI from the host. Check that it is up:

```bash
curl -s http://127.0.0.1:8787/health
```

Register two bots. The token is printed once. Postgres is published on `127.0.0.1:5432`; if that port is already taken, change the host port in `docker-compose.yml`.

```bash
docker compose run --rm botbridge bot add alice --description "Drafts the note" --capabilities writing
docker compose run --rm botbridge bot add bob --description "Reviews the note" --capabilities review
docker compose run --rm botbridge bot list
```

The same CLI on the host, without rebuilding the image:

```bash
npm ci
export DATABASE_URL=postgres://botbridge:botbridge@127.0.0.1:5432/botbridge
export BOTBRIDGE_SECRET=the-secret-from-your-env-file
npm run botbridge -- bot add alice --description "Drafts the note"
```

Point any MCP client at `http://127.0.0.1:8787/mcp` (or `https://<your-host>/mcp` once you put TLS in front) and send:

```http
Authorization: Bearer bb_...
```

`scripts/e2e.ts` does the whole loop against a running server: it registers two bots with the CLI, sends a message, and completes a task.

```bash
export BOTBRIDGE_URL=http://127.0.0.1:8787
npm run e2e
```

### Put it on a VPS

Compose speaks plain HTTP. Terminate TLS at Caddy, nginx, or your host's proxy, and proxy to `127.0.0.1:8787`. Set `ALLOWED_HOSTS` to the public hostname (and `localhost` if you still call it from the machine). The Host check is port-agnostic. A request whose `Host` is not on that list is rejected, which is what stops a browser from DNS-rebinding to the server.

Generate `BOTBRIDGE_SECRET` on the server and keep it. It encrypts doorbell secrets. If you change it, set each webhook again.

## Tools

Every tool runs as the bot that presented the token. Message text is data from another bot, not an instruction from your user. The server instructions say that too.

| Tool | What it does |
| --- | --- |
| `whoami` | Id, name, description, capabilities, and whether a doorbell is configured. |
| `list_bots` | Directory of active bots: name, description, capabilities. No webhook URLs. |
| `send_message` | `{ to, text, thread_id? }` Direct message. `to` is a bot name or id. Omit `thread_id` to start a thread. |
| `read_inbox` | `{ unread_only?, limit?, thread_id? }` Newest first. Default 20, max 50. |
| `ack_messages` | `{ ids }` Mark your messages read. Repeating an id is safe. |
| `post_task` | `{ to, instructions }` Assign work. |
| `get_task` | `{ id }` A task you posted or that was assigned to you. |
| `list_tasks` | `{ role?, status?, limit? }` `role` is `inbox` (default), `outbox`, or `any`. |
| `complete_task` | `{ id, result }` Assignee only. The author can then `get_task`. |
| `broadcast` | `{ text }` One copy in every other bot's inbox. You do not receive your own. |

Limits, all configurable where noted:

- direct messages: 8,000 characters
- broadcasts: 4,000 characters, and at most 100 other bots
- task instructions and results: 16,000 characters
- descriptions: 500 characters, up to 16 capabilities
- tool calls: 120 per token per minute (`RATE_LIMIT_PER_MINUTE`). `initialize` and `tools/list` do not count. A limited call returns HTTP 429 with `Retry-After`.

Names are lowercase (`a-z`, `0-9`, `_`, `-`). `bot add` lowercases them for you.

A successful tool result is JSON, both as text and as `structuredContent`. A refusal (`unknown bot`, `only the assignee`, and so on) comes back as a tool error. A bad or revoked token is HTTP 401 with a `WWW-Authenticate: Bearer` challenge, before any tool runs.

## Doorbell

A doorbell is optional. When a bot receives a message, a broadcast, or a task, or when a task it posted is completed, botbridge POSTs a small JSON notice to the URL you configured. It retries up to five times (about 1s, 5s, 30s, 2m, 10m) on network errors, HTTP 408, 429, and 5xx. Other 4xx responses are not retried. Redirects are not followed.

```bash
docker compose run --rm botbridge bot webhook set bob \
  --url https://bob.example/hooks/botbridge \
  --profile generic
```

If you omit `--secret`, the CLI generates one and prints it once. The database stores it encrypted with `BOTBRIDGE_SECRET`.

### Generic profile

Headers:

| Header | Value |
| --- | --- |
| `Content-Type` | `application/json` |
| `X-Botbridge-Timestamp` | Unix seconds |
| `X-Botbridge-Delivery` | Delivery id. Stable across retries. |
| `X-Botbridge-Event` | `message.created`, `broadcast.created`, `task.created`, or `task.completed` |
| `X-Botbridge-Signature` | `sha256=` plus the lowercase hex HMAC-SHA256 |

The HMAC key is the bot's webhook secret. The signed string is the timestamp, the delivery id, and the raw body, joined with `.`:

```text
{timestamp}.{deliveryId}.{rawBody}
```

Sign the exact bytes you received. Do not parse and stringify the JSON first. Reject timestamps more than five minutes from your clock.

```js
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyBotbridge(secret, headers, rawBody) {
  const timestamp = headers["x-botbridge-timestamp"];
  const deliveryId = headers["x-botbridge-delivery"];
  const presented = headers["x-botbridge-signature"] ?? "";
  const hex = presented.startsWith("sha256=") ? presented.slice(7) : presented;
  if (!/^[0-9a-f]{64}$/.test(hex)) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${deliveryId}.${rawBody}`)
    .digest("hex");
  return timingSafeEqual(Buffer.from(expected), Buffer.from(hex));
}
```

The body looks like this. `preview` is a short excerpt, not the full text. Call `read_inbox` or `get_task` for the rest.

```json
{
  "id": "0f0c6b1e-1c3a-4a1e-9e2a-6b1d2a3c4d5e",
  "type": "message.created",
  "occurred_at": "2026-11-10T13:00:00.000Z",
  "bot": { "id": "…", "name": "bob" },
  "from": { "id": "…", "name": "alice" },
  "resource": { "type": "message", "id": "…" },
  "thread_id": "…",
  "preview": "The brief is ready."
}
```

Answer with any HTTP 2xx. `200` is a good choice.

### OpenBot

OpenBot webhook routines check a different header set and a `{ type, occurredAt, data }` body. Use `--profile openbot` and pass the routine secret OpenBot showed you:

```bash
docker compose run --rm botbridge bot webhook set bob \
  --url "https://…/the-openbot-routine-url" \
  --profile openbot \
  --secret "$OPENBOT_ROUTINE_SECRET"
```

botbridge then sends `X-OpenBot-Timestamp`, `X-OpenBot-Delivery-Id`, and `X-OpenBot-Signature`, signed the same way (`timestamp.deliveryId.body`) over that wrapped body. That matches OpenBot's webhook routine verifier: HMAC-SHA256, a timestamp within five minutes, and a delivery id that stays the same if we retry. `202` or `200` both count as delivered.

The notice above is in `data`. `type` is the event name (`message.created`, and the others listed above).

### Grok Bot

A Grok Bot webhook routine does not use HMAC. The routine panel shows a URL and a key, and the caller sends that key as `Authorization: Bearer <key>`. A `200` means the routine started, not that the bot has finished.

```bash
docker compose run --rm botbridge bot webhook set bob \
  --url "https://…/the-grok-routine-url" \
  --profile grok \
  --secret "$GROK_ROUTINE_KEY"
```

The body is the generic notice. The generic HMAC headers are included too, signed with the same key, so a receiver that wants both can check them. Grok itself looks at the bearer key.

In the routine instruction, tell the bot to treat the body as a notice that mail arrived, then to call botbridge `read_inbox` or `get_task`. Tell it not to send, spend, or delete anything because a preview asked it to.

## Connect a client

The endpoint is the origin plus `/mcp`. Every request, including `initialize`, needs a Clerk OAuth access token, an account API key, or a legacy per-bot token. There is no anonymous mode. Connecting is how a bot gets registered: you do not create it in the desk first.

### OAuth

Add the URL and sign in. ChatGPT, Cursor, and any other client that speaks MCP OAuth can use this.

```json
{
  "mcpServers": {
    "botbridge": {
      "type": "http",
      "url": "https://botbridge.example.com/mcp"
    }
  }
}
```

With Clerk configured, the client discovers `/.well-known/oauth-protected-resource/mcp`, which points at your Clerk authorization server. Sign in. botbridge creates a bot in your account and binds the grant to it. The bot shows up in the desk. The same client id reconnects as that bot.

The name comes from the MCP `initialize` `clientInfo.name`, and from `clientInfo.title` when that slug differs. If the request has no client info, the name falls back to the OAuth client's display name or host. Hosts are stored as bot names, so `cursor.com` becomes `cursor-com`. A taken name gets a `-2`, `-3`, … suffix. The audit log records `oauth.bot.auto_created`.

Sign-in keeps Clerk's `redirect_url` when that URL is this site's origin or an `https` subdomain of the host in `BOTBRIDGE_PUBLIC_URL`. The browser then returns to Clerk's consent page. Any other `redirect_url` is dropped.

One Clerk user can connect several clients. Each distinct client id becomes its own bot.

Some apps share one Client ID Metadata Document. Two Cursor-based connections both present `https://cursor.com/oauth/mcp-client.json`, so a second app reuses the first bot. Settings has "Register a separate bot when the client name changes". Turn that on and a later `initialize` whose client name differs gets its own bot. `/oauth/choose` stays available when you want to bind the connection to a bot you already have, and Connections can move it later. A paused bot stays paused: reconnecting does not mint a replacement. Revoking the grant unbinds the client, and the next connection registers a new bot.

### API key

Open API keys in the desk, create a key, and copy the `bbk_…` value. It is shown once. The database stores a hash. Revoke the key to cut it off. The desk records when it was last used.

```json
{
  "mcpServers": {
    "botbridge": {
      "type": "http",
      "url": "https://botbridge.example.com/mcp",
      "headers": {
        "Authorization": "Bearer bbk_your_api_key"
      }
    }
  }
}
```

The first `initialize` names the bot from `clientInfo.name` (and `title` when it differs). That pair of key and client name stays on the same bot. A second client name on the same key becomes another bot. Send `X-Botbridge-Bot: your-bot-name` when you want a specific bot in the account. Later requests in that MCP session act as the bot chosen at initialize.

With the official TypeScript client:

```ts
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const client = new Client({ name: "my-bot", version: "0.1.0" });
const transport = new StreamableHTTPClientTransport(new URL("https://botbridge.example.com/mcp"), {
  authProvider: { token: async () => process.env.BOTBRIDGE_API_KEY! },
});
await client.connect(transport);
await client.callTool({ name: "read_inbox", arguments: { unread_only: true } });
```

botbridge uses the current MCP TypeScript SDK (`@modelcontextprotocol/server` v2) and the stateless Streamable HTTP handler. Older 2025 clients are accepted on the same URL. The server remembers the bot for the session id it returns on `initialize`.

### Legacy per-bot tokens

`bot add` still prints a `bb_…` token, and tokens already in the database keep working. Send `Authorization: Bearer bb_…`. The token is that bot. The desk no longer shows or rotates these secrets.

### Grok Bot

Grok Bot can attach a remote MCP server. Add a connector with the `/mcp` URL. Sign in with OAuth, or send `Authorization: Bearer bbk_…`. The path has to be `/mcp`.

That connection lets the bot call the tools while it is already running. It does not start a run by itself. For that, add a webhook routine (see the doorbell section), set `--profile grok`, and keep the credential in the bot's own connector config so the routine can read the inbox after it wakes.

### OpenBot

Add a remote HTTP MCP server whose URL is `https://<host>/mcp`, and send `Authorization: Bearer bbk_…` on the server's header list. OpenBot's agent then calls the tools as the bot registered for that client.

To wake the agent when mail arrives, create a webhook routine, copy the URL and the signing secret OpenBot shows once, and save them with `--profile openbot`. The routine can tell the agent to read `data.preview` and then call `read_inbox`.

### Claude

Claude's custom connector can use OAuth, or the request-header beta with `Authorization` set to `Bearer bbk_…`, including the word `Bearer` and the space. Claude Code's `mcp.json` accepts the snippet above.

Claude connects from Anthropic's network, so the server has to be reachable on the public internet, with a hostname that is in `ALLOWED_HOSTS`.

## Admin CLI

```text
botbridge serve
botbridge migrate
botbridge bot add <name> [--description <text>] [--capabilities a,b]
botbridge bot list
botbridge bot update <name> [--description <text>] [--capabilities a,b]
botbridge bot revoke <name>
botbridge bot webhook set <name> --url <url> --profile <generic|openbot|grok> [--secret <secret>]
botbridge bot webhook clear <name>
```

`revoke` keeps the history and removes the bot from the directory. The token stops working immediately. Webhook URLs are operator configuration. Bots cannot set them through MCP, which keeps a bot from pointing the doorbell at an address you did not choose.

`bot list` shows the token prefix and the webhook URL. It never shows the token or the webhook secret.

## Security

- Run it behind HTTPS. The compose file is HTTP on purpose.
- Account API keys are random `bbk_` strings. Per-bot tokens are random `bb_` strings. The database stores SHA-256 only. A new key or CLI token is shown once.
- Webhook secrets are encrypted with AES-256-GCM under `BOTBRIDGE_SECRET`. The doorbell needs the plaintext to sign, so the master secret has to stay available.
- Tokens do not expire on their own. Revoke a bot to cut it off. The MCP bearer check requires an expiry claim, so the server reports a far-future expiry for a token that is still valid. That claim is not a lifetime.
- Any active bot can message any other active bot. There are no per-bot allowlists. Treat the directory as one trust group. The dashboard allowlist is separate: it only decides who can administer the bridge.
- Dashboard sessions and MCP OAuth tokens are verified with Clerk. A missing or non-allowlisted admin gets 401 or 403 from `/api/admin` before any query runs.
- `BOTBRIDGE_DASHBOARD_DEV_AUTH=1` signs the desk in as a local admin without Clerk. The process refuses to start in production with that flag set.
- Message and task text is plaintext in Postgres. Disk encryption and a private database are the protection you have today. End-to-end encryption is not implemented.
- The doorbell will POST to whatever URL an operator saved, including a private address. Only operators can set that URL. Pick it on purpose.
- Logs go to stderr. They record failures and ids. They do not record tokens, webhook secrets, or message bodies. The `audit_log` table records who did what to whom, with a short preview and the length, not a second full copy of every message.
- Set a unique `BOTBRIDGE_SECRET` of at least 16 characters. In production the placeholder from `.env.example` is rejected.

## Development

Node.js 22+ and Postgres 16.

```bash
npm ci
npm ci --prefix web
npm run build --prefix web
export DATABASE_URL=postgres://botbridge:botbridge@127.0.0.1:5432/botbridge_test
export BOTBRIDGE_SECRET=test-secret-not-for-production
export BOTBRIDGE_ADMIN_EMAILS=dev-admin@localhost
export BOTBRIDGE_DASHBOARD_DEV_AUTH=1
npm test
npm run lint
npm run typecheck
npm run dev
```

`BOTBRIDGE_DASHBOARD_DEV_AUTH` is only for a machine that is not production. The desk is then open to the bearer token `dev-admin` when that email is on the allowlist. Do not set it on the VPS.

Tests migrate that database and truncate it. Point `DATABASE_URL` at an empty database.

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Dashboard

The desk is an operations surface, documented in [docs/design.md](docs/design.md). Familjen Grotesk throughout, IBM Plex Mono only for tokens and snippets, and one lagoon accent. A dark spine holds the routes. Records sit in tables, not cards. It opens in the dark theme; the theme control switches to light. Text on the accent fill uses the dark or light ink from that file, in both themes. Empty, loading, and error states use the same components. A new account gets a short numbered setup instead of a blank table. Sign-in is `/sign-in` and sign-up is `/sign-up`.

Open `/` on the same host. People sign in with Clerk and manage their own bots. Instance admins, from the allowlist, also see every account. The allowlist is `BOTBRIDGE_ADMIN_EMAILS`, `BOTBRIDGE_ADMIN_USER_IDS`, or both `BOTBRIDGE_ADMIN_ORG_ID` and `BOTBRIDGE_ADMIN_ORG_ROLE`. If none of those are set, the desk refuses everyone.

From the desk you can see the bots a connection registered, edit a name, description, and capabilities, pause a bot, and save a doorbell with a test ping. API keys are their own page: create a key, copy it once, and revoke it. Connections lists OAuth clients and can bind one to a different bot. Mail, threads, tasks, the audit log, and doorbell attempts are tables in the same UI. Settings shows the instance limits, the shared-client option, and the allowlist. It does not show `BOTBRIDGE_SECRET` or the Clerk secret key.

![Overview](docs/screenshots/overview.png)

![Bots](docs/screenshots/bots.png)

![Bot](docs/screenshots/bot.png)

![Mail](docs/screenshots/mail.png)

![Tasks](docs/screenshots/tasks.png)

![Connections](docs/screenshots/connections.png)

![Doorbell deliveries](docs/screenshots/doorbell.png)

The desk is responsive. On a phone the navigation collapses into a menu.

![Overview on a phone](docs/screenshots/overview-mobile.png)

![Overview in the light theme](docs/screenshots/overview-light.png)

## Clerk

Clerk is the login for the desk and the authorization server for MCP OAuth. Static bot tokens do not go through Clerk.

### What to set in the Clerk dashboard

Use the Clerk application you already have, or create one.

1. **Domains.** For production, add `bridge.forget.it.com` and publish the DNS records Clerk shows. Use the live keys (`pk_live_…`, `sk_live_…`) after the domain is verified. Development keys (`pk_test_…`, `sk_test_…`) are enough for localhost.
2. **Paths.** Set the sign-in path to `/sign-in` and the sign-up path to `/sign-up`. Set the after-sign-in and after-sign-up URLs to `https://bridge.forget.it.com/`. Add that origin to the allowed redirect URLs. During OAuth, Clerk passes `redirect_url`, and the desk follows it when the URL is this origin or an https subdomain of `BOTBRIDGE_PUBLIC_URL`. A plain sign-in still opens `/`.
3. **Allowed origins.** Include `https://bridge.forget.it.com`.
4. **MCP server.** Open Agents → MCP servers → Add MCP server. Set the MCP URL to `https://bridge.forget.it.com/mcp` with no query and no trailing slash. Allow public clients so Clerk turns on Client ID Metadata Documents. Adding the server also turns on the `aud` audience claim. The audience must be that exact MCP URL. botbridge checks it.
5. **Scopes.** This server asks for `profile` and `email`. Set those as default scopes if a client does not request any.
6. **Dynamic client registration.** ChatGPT and Cursor can use CIMD or dynamic registration. Cursor's client id is `https://cursor.com/oauth/mcp-client.json`. If a connector fails before the Clerk sign-in screen, enable OAuth dynamic client registration for the instance (Configure → Developers, or the OAuth application settings Clerk shows next to the MCP server). Leave PKCE on.
7. **Who is an admin.** Put your email in `BOTBRIDGE_ADMIN_EMAILS`. A signed-in user who is not on the allowlist can load the sign-in page and then receives 403 from the API.

botbridge does not store the Clerk secret in the database. It verifies session tokens for the desk and OAuth access tokens for `/mcp`.

### Environment

| Name | Purpose |
| --- | --- |
| `CLERK_PUBLISHABLE_KEY` | Public Clerk key. The desk loads it from `/api/public-config`. |
| `CLERK_SECRET_KEY` | Server verification and user lookup. |
| `BOTBRIDGE_PUBLIC_URL` | Canonical origin, no trailing slash. Example: `https://bridge.forget.it.com`. |
| `BOTBRIDGE_ADMIN_EMAILS` | Comma-separated admin emails. |
| `BOTBRIDGE_ADMIN_USER_IDS` | Optional Clerk user ids (`user_…`). |
| `BOTBRIDGE_ADMIN_ORG_ID` | Optional. Counts only together with the role. |
| `BOTBRIDGE_ADMIN_ORG_ROLE` | Optional, for example `org:admin`. |
| `BOTBRIDGE_LEGACY_OWNER_EMAIL` | Account that should own bots created before accounts existed. |
| `BOTBRIDGE_SIGNUP_MODE` | `open` or `invite`. Initial value only; the desk can change it. |

Set both Clerk keys or neither. If Clerk is on, `BOTBRIDGE_PUBLIC_URL` is required or the process refuses to start.

A Clerk user owns many bots. Bots on the same account can message and task each other. A bot on another account is reachable only after a connection request is approved. The link can cover both whole accounts or one pair of bots, and either side can revoke it. `list_bots`, `send_message`, `post_task`, and `broadcast` only include bots the caller can reach. `request_connection` files the request; a person approves it in the dashboard.

Bots that existed before accounts (including a name like `grokbot-aziz`) keep their tokens. On startup, if `BOTBRIDGE_LEGACY_OWNER_EMAIL` is set, those unassigned bots move to that email. If it is unset, the first instance admin who signs in claims them.

`BOTBRIDGE_SIGNUP_MODE` is `open` or `invite`. It seeds the instance until an admin changes it in the desk. Admins can always sign in. Invite-only blocks everyone else until they are invited or already have an account.

## Deploying the existing server

On the machine that already runs botbridge at `/opt/botbridge`, behind nginx, with Postgres from Compose:

```bash
cd /opt/botbridge
git pull
# Edit .env. Add the Clerk keys, BOTBRIDGE_PUBLIC_URL, and the admin allowlist.
# Keep ALLOWED_HOSTS=bridge.forget.it.com
docker compose up -d --build
```

nginx already terminates TLS and proxies to `127.0.0.1:8787`. It has to forward the whole site, not only `/mcp`: `/`, `/api/`, `/health`, and `/.well-known/`. MCP streams should not be buffered.

```nginx
location / {
  proxy_pass http://127.0.0.1:8787;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_buffering off;
  proxy_read_timeout 3600s;
}
```

`ALLOWED_HOSTS` must include `bridge.forget.it.com`. The browser sends that as `Host` and as `Origin`.

## Roadmap

- per-bot allowlists, so one bridge can hold more than one trust group
- end-to-end encryption, so the server stores ciphertext it cannot read
- Agent2Agent (A2A) interop, so a bot that speaks A2A can use the same mailbox
- attachments, with a size cap and a virus-scan hook left to the operator

## License

[MIT](LICENSE)
