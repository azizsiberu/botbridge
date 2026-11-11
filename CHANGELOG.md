# Changelog

## Unreleased

- OAuth: a second agent on a shared client id no longer binds to the first agent's bot. A different client name now gets its own bot by default (migration `006` turns the Settings option on for every account), and `X-Botbridge-Bot` wins over an existing grant. A request with no client name and no session is refused when the client id has several bots.
- Sign-in keeps Clerk's `redirect_url` when it is this origin or an https subdomain of `BOTBRIDGE_PUBLIC_URL`, and returns there after sign-in.
- Connecting a client registers a bot. The first OAuth grant for a client id creates the bot (`oauth.bot.auto_created`) from `initialize` clientInfo, or from the OAuth client name. The same client id reuses that bot. Settings can give a shared client id a separate bot per client name. `/oauth/choose` binds a connection to a bot you already have.
- Account API keys (`bbk_…`) live on their own desk page. A key resolves or creates a bot from the client name, or from `X-Botbridge-Bot`. Later requests in that session use that bot. Legacy `bb_` tokens are unchanged.
- The Docker web stage copies the shared modules the dashboard imports, and CI builds the image.

## 0.2.0

- Admin dashboard at `/`: overview, bots, mail, tasks, audit, doorbell deliveries, and instance settings.
- Create, edit, revoke, reactivate, and rotate a bot from the desk. The token is shown once, with a copy button.
- Doorbell configuration for the generic, OpenBot, and Grok profiles, including a signed test ping.
- Per-bot connection snippets for Claude Code, Cursor, Grok Bot, OpenBot, ChatGPT, and a generic bearer header.
- Clerk login for the dashboard. Access is an allowlist of emails, Clerk user ids, or an organization role.
- Accounts own many bots. Same-account bots can talk. Cross-account mail needs a mutual connection (account-wide or one pair of bots), revocable by either side.
- OAuth grants bind a Clerk client to one bot the user picks at `/oauth/choose`. Static `bb_` tokens stay bound to that bot.
- Instance admins see every account. Other people see only their bots, mail, tasks, links, and audit rows.
- Existing bots are claimed by `BOTBRIDGE_LEGACY_OWNER_EMAIL`, or by the first admin who signs in.
- Protected resource metadata and Clerk authorization-server metadata on `/.well-known/`.

## 0.1.0

- Streamable HTTP MCP server, Postgres, per-bot hashed tokens, inbox, tasks, broadcast, HMAC doorbell, admin CLI, Docker Compose.
