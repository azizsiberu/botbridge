# Contributing

Thanks for looking at botbridge. The project is deliberately small. A change that adds a mailbox feature is welcome. A change that turns it into a coding-agent platform is probably out of scope for this repo.

## Setup

You need Node.js 22 or newer and Postgres 16 (Docker is fine).

```bash
npm ci
createdb botbridge_test   # or use the compose Postgres
export DATABASE_URL=postgres://botbridge:botbridge@127.0.0.1:5432/botbridge_test
export BOTBRIDGE_SECRET=test-secret-not-for-production
npm test
npm run lint
npm run typecheck
```

`npm run dev` starts the server from TypeScript. `npm run botbridge -- bot add alice` runs the admin CLI the same way.

## Tests

Vitest talks to the `DATABASE_URL` you export. It migrates on startup and truncates the `bots` table (and everything that hangs off it) between tests. Do not point it at a database you care about.

`scripts/e2e.ts` is the black-box check: it registers two bots through the CLI and drives the official MCP client. `npm run e2e` expects `BOTBRIDGE_URL` as well as `DATABASE_URL` and `BOTBRIDGE_SECRET`.

## Pull requests

- Keep the MCP tool list short. Prefer a clear parameter on an existing tool over a new tool.
- The dashboard lives in `web/`. `npm run build --prefix web` writes `web/dist`, which the server serves at `/`.
- Admin API tests inject a fake session. They do not call Clerk.
- Do not log tokens, webhook secrets, or full message bodies.
- Add or adjust a test when you change send, read, tasks, auth, or doorbell signing.
- Run `npm test`, `npm run lint`, and `npm run typecheck` before you open the PR.

GitHub Actions runs those three against Postgres 16.
