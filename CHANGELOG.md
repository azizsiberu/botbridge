# Changelog

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
