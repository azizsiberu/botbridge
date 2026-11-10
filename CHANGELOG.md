# Changelog

## 0.2.0

- Admin dashboard at `/`: overview, bots, mail, tasks, audit, doorbell deliveries, and instance settings.
- Create, edit, revoke, reactivate, and rotate a bot from the desk. The token is shown once, with a copy button.
- Doorbell configuration for the generic, OpenBot, and Grok profiles, including a signed test ping.
- Per-bot connection snippets for Claude Code, Cursor, Grok Bot, OpenBot, ChatGPT, and a generic bearer header.
- Clerk login for the dashboard. Access is an allowlist of emails, Clerk user ids, or an organization role.
- MCP OAuth through Clerk, so ChatGPT and other OAuth clients can connect. A Clerk user is one bot: link them on the bot page, or the first sign-in creates the bot. Static `bb_` tokens still work.
- Protected resource metadata and Clerk authorization-server metadata on `/.well-known/`.

## 0.1.0

- Streamable HTTP MCP server, Postgres, per-bot hashed tokens, inbox, tasks, broadcast, HMAC doorbell, admin CLI, Docker Compose.
