# WorkPowers Live Fork Spike

A small proof-of-concept for a WorkPowers Live Fork Session: a temporary app reality shared by a human preview URL and an agent running commands, browser automation, and file edits inside the same sandbox.

## Shape

- `apps/control-plane`: minimal WorkPowers API for creating, commanding, reading logs/diffs, and stopping sessions.
- `apps/session-daemon`: primitive in-sandbox command API for health, logs, file IO, process control, git diff, and Playwright.
- `apps/spike-app`: React + Vite + Better Auth + Postgres + Drizzle app with `/login`, `/dashboard`, and `/projects`.
- `scripts/sandbox-bootstrap-postgres.sh`: sandbox-local Postgres bootstrap, using Docker Compose when available and local `pg_ctl` as a fallback.

## Local Run

```bash
pnpm install
cp .env.example .env
docker compose up -d postgres
pnpm db:migrate
pnpm db:seed
pnpm dev:spike-api
pnpm dev:spike
```

Open `http://localhost:3000/login` and sign in with:

```txt
agent@example.com
password1234
```

Run the control plane separately:

```bash
pnpm dev:control
```

Create a local-mode session:

```bash
curl -s http://localhost:8787/sessions \
  -H 'Content-Type: application/json' \
  -d '{
    "repoUrl": "local",
    "ref": "main",
    "template": "node-pnpm-playwright-postgres",
    "data": { "mode": "local_seed", "seedName": "basic-projects" }
  }'
```

## Daytona Mode

Set these environment variables before starting the control plane:

```bash
LIVE_FORK_PROVIDER=daytona
DAYTONA_API_KEY=...
DAYTONA_API_URL=https://app.daytona.io/api
DAYTONA_TARGET=us
LIVE_FORK_TEMPLATE_IMAGE=
```

Then call `POST /sessions` with a real Git repository URL. The Daytona provider:

1. creates an ephemeral public Daytona sandbox,
2. clones the repo and checks out the requested ref,
3. writes sandbox-local env with Postgres on `localhost:5432`,
4. installs dependencies,
5. starts sandbox-local Postgres and seed data,
6. starts the API and Vite dev server,
7. installs the Playwright Chromium browser,
8. returns a signed preview URL for port `3000`.

The app and Playwright use `http://localhost:3000` inside the sandbox. The human opens the returned Daytona preview URL.

## Control Plane API

```txt
POST /sessions
GET  /sessions/:id
POST /sessions/:id/command
GET  /sessions/:id/logs
GET  /sessions/:id/diff
POST /sessions/:id/stop
```

## Session Daemon API

```txt
GET  /health
POST /run-command
GET  /logs
GET  /git-diff
POST /write-file
GET  /read-file
POST /start-process
POST /stop-process
POST /run-playwright
```

## Template/Warm Pool Notes

The cold path should bake in Node, pnpm, Playwright browsers, Postgres, and common system packages. The hot path should only claim/start a warm sandbox, checkout code, inject env, run migrations/seeds, and start the app processes.
