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
WORKPOWERS_SECRET_ENCRYPTION_KEY=...
DAYTONA_API_KEY=...
DAYTONA_API_URL=https://app.daytona.io/api
LIVE_FORK_SNAPSHOT_NAME=workpowers-daytona-node-playwright-postgres
```

`WORKPOWERS_SECRET_ENCRYPTION_KEY` is required before storing org-owned target app credentials, such as a Neon API key. Use a random 32-byte key encoded as hex or base64 and keep it stable for the local control-plane database you are using.

Do not set `DAYTONA_TARGET=us` for the WorkPowers EU org. Let Daytona use the org default region, or set the correct EU target once the exact target id is known.

The snapshot is based on `mcr.microsoft.com/playwright:v1.59.1-noble` and bakes in Node, `pnpm@10.29.1`, git, curl, Postgres server/client tools, Playwright, common OS dependencies, and the WorkPowers session daemon. If `LIVE_FORK_SNAPSHOT_NAME` is blank, the Daytona provider uses `workpowers-daytona-node-playwright-postgres`.

Check or create the snapshot with:

```bash
pnpm daytona:snapshot:status
pnpm daytona:snapshot
```

If the Daytona API key cannot create snapshots, Daytona returns `403 Access denied`. Fix the key permissions rather than drifting to the old cold image fallback. The current intended runtime path is the active `workpowers-daytona-node-playwright-postgres` snapshot.

### Profile-Driven Sessions

Production-shaped sessions are started from a live fork profile rather than a hardcoded app boot path. A profile describes:

- GitHub repo owner/name and optional org GitHub App credential reference.
- Daytona snapshot/resources.
- install and setup commands.
- one or more services, including the preview service and healthcheck.
- required env values.
- data mode, including Neon branch environments.
- the in-sandbox browser check command.
- TTL and idle timeout.

The checked-in profiles are:

- `workpowers.livefork.yml`: the WorkPowers spike app using sandbox-local Postgres seed data.
- `profiles/ringofbeara.workpowers.livefork.yml`: a private Astro/EmDash app using org GitHub App checkout and per-session Neon branches.

Create a profile session through the control plane:

```bash
curl -sS -X POST http://localhost:8787/sessions \
  -H 'Content-Type: application/json' \
  -d '{
    "profilePath": "profiles/ringofbeara.workpowers.livefork.yml",
    "userId": "USER_ID",
    "organizationId": "ORG_ID"
  }'
```

The Daytona provider now:

1. loads the profile,
2. resolves org GitHub App repository access when requested,
3. resolves the configured app environment,
4. creates a per-session Neon branch when the profile uses `data.primary.provider: neon`,
5. creates a Daytona sandbox from the snapshot,
6. clones the private repo and checks out the requested ref,
7. writes session-specific env, including the fork branch `DATABASE_URL`,
8. installs dependencies and runs profile setup commands,
9. starts the session daemon,
10. starts profile services,
11. checks service health,
12. returns the Daytona preview URL.

The human opens the returned Daytona preview URL. Agents use the session daemon for commands, file IO, logs, diff export, and browser checks.

### Target App Environments

Target app database credentials are stored as org-owned encrypted credentials, not as normal WorkPowers process env. The control UI includes a small Ring of Beara Neon environment form for the current proof app. The underlying API is general enough for this v0 shape:

```txt
POST /app-environments/neon
```

The target app environment stores non-secret Neon identifiers: project id, parent branch id, database name, role name, and pooled/direct mode. The Neon API key is stored encrypted in `org_credentials` and resolved only when creating or deleting branches.

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

On 2026-05-01, the production-shaped Ring of Beara path was verified against Daytona, GitHub App checkout, and Neon:

- private repo cloned from `evanfuture/ringofbeara.com` using org GitHub App access
- per-session Neon branch created from the configured parent branch
- Astro/EmDash booted from the profile command on port `4321`
- `/workpowers/fork-proof` rendered inherited parent data through the fork branch `DATABASE_URL`
- an in-sandbox command mutated the fork marker to `fork-mutated`
- the parent Neon branch still read `status: parent`
- explicit stop deleted the Daytona sandbox and Neon branch

See [docs/production-live-fork-v0.md](docs/production-live-fork-v0.md) for the detailed proof log.

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
POST /sessions/:id/agent-runs
GET  /sessions/:id/agent-runs
GET  /sessions/:id/agent-runs/:runId
POST /sessions/:id/agent-runs/:runId/stdin
POST /sessions/:id/agent-runs/:runId/resize
POST /sessions/:id/agent-runs/:runId/stop
GET  /sessions/:id/agent-runs/:runId/events
POST /sessions/:id/stop
```

Session records and AgentRun records are persisted to `.workpowers/sessions.json` and redacted before public responses. Preview tokens, daemon URLs, GitHub tokens, Neon credentials, and Claude Code harness credentials stay internal.

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
POST /terminals
GET  /terminals/:id
GET  /terminals/:id/events
POST /terminals/:id/stdin
POST /terminals/:id/resize
POST /terminals/:id/kill
```

## Template/Warm Pool Notes

The cold path should bake in Node, pnpm, Playwright browsers, Postgres, and common system packages. The hot path should only claim/start a warm sandbox, checkout code, inject env, run migrations/seeds, and start the app processes.

The current cold path intentionally still installs dependencies and Postgres at session creation time. That is acceptable for the proof, but not for the intended constant-use experience.
