# Live Fork Session Notes

## Session Object

The control plane persists session records to `.workpowers/sessions.json`, redacts public responses, and reconciles active sessions on startup. A session now carries both runtime state and ownership context.

```ts
type LiveForkSession = {
  id: string;
  createdByUserId?: string;
  organizationId?: string;
  repoUrl: string;
  ref: string;
  branchName?: string;
  sandbox: {
    provider: "daytona";
    sandboxId: string;
    status: "starting" | "running" | "stopped" | "failed";
  };
  app: {
    internalUrl: string;
    previewUrl: string;
    devCommand: string;
    healthcheckUrl: string;
  };
  data: {
    mode: "local_seed" | "curated_seed" | "db_branch" | "snapshot_restore";
    resettable: boolean;
    provider?: "local" | "neon";
    branchId?: string;
    endpointId?: string;
    environmentRef?: string;
  };
  lifecycle: {
    createdAt: string;
    expiresAt: string;
    idleTimeoutMinutes: number;
    maxLifetimeMinutes: number;
  };
  artifacts: {
    gitDiff?: string;
    logs?: string[];
    screenshots?: string[];
    playwrightTrace?: string;
  };
};
```

## Provider Boundary

Daytona supplies the floor: sandbox creation, command execution, process hosting, and preview URLs. WorkPowers owns the room: session records, lifespan, seed selection, command policy, logs, diffs, artifacts, and agent collaboration semantics.

For production-shaped sessions, WorkPowers also owns target app environment resolution. Runtime providers should receive already-resolved checkout, data branch, and env decisions instead of reading target app secrets directly from process env.

## Profile-Driven Boot

`POST /sessions` accepts either the old explicit request shape or a `profilePath`. A profile is the unit that makes a target app repeatable:

```yaml
name: ringofbeara
repo:
  provider: github
  owner: evanfuture
  name: ringofbeara.com
  credentialRef: org:github-app
runtime:
  provider: daytona
  snapshot: workpowers-daytona-node-playwright-postgres
services:
  web:
    command: pnpm dev --host 0.0.0.0 --port 4321
    port: 4321
    preview: true
    healthcheck: http://localhost:4321
data:
  primary:
    kind: branch
    provider: neon
    environmentRef: ringofbeara:staging
```

The boot path is:

```txt
load profile
resolve GitHub App access, if requested
resolve app environment
create Neon branch, if requested
create Daytona sandbox
clone repo
write session env
install dependencies
run profile setup commands
start daemon
start services
check health
return preview URL
```

The session daemon remains the post-boot boundary for commands, logs, file reads/writes, diff export, and Playwright.

## Data Branches

The Neon integration is target-app scoped:

- WorkPowers stores target apps in `live_fork_apps`.
- WorkPowers stores app environments in `live_fork_app_environments`.
- Non-secret Neon project config lives on the app environment.
- The Neon API key is stored as an encrypted org-owned credential in `org_credentials`.
- The control plane creates a branch for each session, injects its `DATABASE_URL`, records internal branch metadata, and deletes the branch on stop or TTL cleanup.

Target app Neon credentials should not be added as normal WorkPowers `.env` variables. Only `WORKPOWERS_SECRET_ENCRYPTION_KEY` belongs in WorkPowers env so org credentials can be encrypted and decrypted.

## Spike Result

The real Daytona run on 2026-04-29 validated the first heartbeat:

```txt
create sandbox
clone repo
install dependencies
start sandbox-local Postgres
run migrations and seed
start API and Vite
expose a Daytona preview URL
run Playwright inside the sandbox against localhost
edit code in the sandbox
observe Vite HMR
export git diff
```

Important implementation details from the run:

- The GitHub repo had to be public for anonymous clone. Private repo support needs explicit clone credentials.
- The WorkPowers org is in the EU region; hardcoding `DAYTONA_TARGET=us` fails.
- The default Daytona TypeScript sandbox had Node, npm, and git, but not pnpm, Docker, or Postgres tools.
- The default sandbox was too small for this Vite/Better Auth/Postgres/Playwright stack and Vite was killed with exit code `137`.
- Image-based sandboxes allowed resource requests. The successful run used `mcr.microsoft.com/playwright:v1.59.1-noble`, 2 CPU, 4 GB memory, and 10 GB disk.
- Daytona rejected 20 GB disk under the current org limit.
- The sandbox bootstrap needs to handle both non-root default sandboxes and root image-based sandboxes.
- The original spike used Daytona's process API directly. The repeatable-session v0 now routes post-bootstrap commands, logs, file IO, diff export, and Playwright through the session daemon.

## Repeatable Session v0

- Session records are stored in `.workpowers/sessions.json` and reconciled on control-plane startup.
- `POST /sessions` is asynchronous and records boot phases from sandbox creation through `ready` or `failed`.
- Public session responses are redacted so preview tokens and daemon URLs stay internal.
- The control plane uses the session daemon for commands, file reads/writes, logs, diffs, and Playwright once bootstrapping completes.
- TTL cleanup stops expired active sessions and marks them stopped.
- The `apps/control-ui` Vite app provides the smallest visible loop: start, inspect phases, preview, read/write a file, run Playwright, show logs, show diff, and stop.

## Production-App Proof

On 2026-05-01, Ring of Beara proved the production-shaped path:

```txt
private GitHub App checkout
profile-driven Astro boot
org-owned Neon app environment
per-session Neon branch
fork DATABASE_URL injection
browser-visible fork marker
in-fork data mutation
parent branch isolation
explicit runtime and data cleanup
```

Ring is a verified fixture for v0, not the general product boundary. The generalizable contract is the app profile plus app environment records; a future app should provide the same ingredients and can use a different proof marker.

## Still Deferred

- Warm pool preclaiming.
- Full control-plane auth and multi-tenant authorization around the new app environment endpoints.
- PR creation/promotion.
- Generalized data providers beyond Neon.
- Rich credential-vault UI beyond the current small app-environment setup surface.
