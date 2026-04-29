# WorkPowers Live Fork Spike

A small proof-of-concept for a WorkPowers Live Fork Session: a temporary app reality shared by a human preview URL and an agent running commands, browser automation, and file edits inside the same sandbox.

## Shape

- `apps/control-plane`: minimal WorkPowers API for creating, commanding, reading logs/diffs, and stopping sessions.
- `apps/control-ui`: minimal WorkPowers operator UI for starting sessions, watching boot phases, previewing, editing, running Playwright, and stopping sessions.
- `apps/session-daemon`: primitive in-sandbox command API for health, logs, file IO, process control, git diff, and Playwright.
- `apps/spike-app`: React + Vite + Better Auth + Postgres + Drizzle app with `/login`, `/dashboard`, and `/projects`.
- `infra/daytona/workpowers-daytona-node-playwright-postgres.Dockerfile`: warm snapshot image definition for Daytona.
- `scripts/sandbox-bootstrap-postgres.sh`: sandbox-local Postgres bootstrap, using Docker Compose when available and local `pg_ctl` as a fallback.

## Local Run

```bash
pnpm install
cp .env.example .env
docker compose up -d postgres
pnpm db:migrate
pnpm db:seed
pnpm dev:daemon
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

Run the control UI separately:

```bash
pnpm dev:control-ui
```

Open `http://localhost:5173` to start and operate local-mode sessions.

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

`POST /sessions` is asynchronous. It returns a `202` response immediately and the session reaches `running` when the boot phase becomes `ready`.

## Daytona Mode

Set these environment variables before starting the control plane:

```bash
LIVE_FORK_PROVIDER=daytona
DAYTONA_API_KEY=...
DAYTONA_API_URL=https://app.daytona.io/api
LIVE_FORK_SNAPSHOT_NAME=workpowers-daytona-node-playwright-postgres
```

Do not set `DAYTONA_TARGET=us` for the WorkPowers EU org. Let Daytona use the org default region, or set the correct EU target once the exact target id is known.

Create or refresh the warm snapshot with:

```bash
pnpm daytona:snapshot
```

The snapshot is based on `mcr.microsoft.com/playwright:v1.59.1-noble` and bakes in Node, `pnpm@10.29.1`, git, curl, Postgres server/client tools, Playwright, common OS dependencies, and the WorkPowers session daemon. If `LIVE_FORK_SNAPSHOT_NAME` is not set, the Daytona provider falls back to `LIVE_FORK_TEMPLATE_IMAGE` and the previous cold image path.

If the Daytona API key cannot create snapshots, Daytona returns `403 Access denied`. In that case, clear `LIVE_FORK_SNAPSHOT_NAME` and use:

```bash
LIVE_FORK_TEMPLATE_IMAGE=mcr.microsoft.com/playwright:v1.59.1-noble
```

That image fallback still verifies the real Live Fork loop, but it takes the cold path and installs dependencies/Postgres work during session boot.

Then call `POST /sessions` with a real Git repository URL. The Daytona provider:

1. creates an ephemeral public Daytona sandbox,
2. clones the repo and checks out the requested ref,
3. writes sandbox-local env with Postgres on `localhost:5432`,
4. installs dependencies,
5. starts the session daemon on port `8790`,
6. starts sandbox-local Postgres,
7. runs migrations and seed data,
8. starts the API and Vite dev server,
9. returns signed preview URLs for the app and internal daemon.

The app and Playwright use `http://localhost:3000` inside the sandbox. The human opens the returned Daytona preview URL.

### Verified Daytona Runs

On 2026-04-29, the spike successfully proved the end-to-end loop with a real Daytona sandbox:

- repo cloned from `https://github.com/workpowers/workpowers-sandbox-spike.git`
- app served through a Daytona preview URL for port `3000`
- API served internally on `localhost:3001`
- Postgres ran inside the sandbox with seeded auth/project data
- Playwright ran inside the sandbox against `http://localhost:3000`
- a React file was edited inside the sandbox
- Vite hot reloaded the preview
- the control plane exported the sandbox git diff

The successful cold run used `LIVE_FORK_TEMPLATE_IMAGE=mcr.microsoft.com/playwright:v1.59.1-noble` with 2 CPU, 4 GB memory, and 10 GB disk. Daytona rejected 20 GB disk for the current org limit.

On 2026-04-29, the repeatable-session v0 was also verified against Daytona using the image fallback path:

- async boot events reached `ready`
- the session daemon started inside the sandbox and passed health checks
- Postgres, migrations, seed data, API, Vite, and preview health checks completed
- file read/write, diff export, and Playwright ran through the daemon endpoints
- Playwright passed inside the Daytona sandbox after a non-breaking sandbox edit

See [docs/planner-handoff.md](docs/planner-handoff.md) for findings and recommended next steps.

## Control Plane API

```txt
POST /sessions
GET  /sessions
GET  /sessions/:id
GET  /sessions/:id/events
POST /sessions/:id/command
POST /sessions/:id/playwright
GET  /sessions/:id/logs
GET  /sessions/:id/diff
GET  /sessions/:id/files?path=...
PUT  /sessions/:id/files
POST /sessions/:id/stop
```

Session records are persisted to `.workpowers/sessions.json` and redacted before public responses. Preview tokens and daemon URLs stay internal.

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

The current cold path intentionally still installs dependencies and Postgres at session creation time. That is acceptable for the proof, but not for the intended constant-use experience.
