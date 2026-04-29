# Live Fork Session Notes

## Session Object

The spike keeps the session object in memory. A production control plane should persist it and attach lifecycle policies.

```ts
type LiveForkSession = {
  id: string;
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

## Still Deferred

- Private repo checkout through GitHub App tokens or short-lived deploy credentials.
- Managed database branch/snapshot modes such as Neon, Supabase, or snapshot restore.
- Warm pool preclaiming.
- Auth, multi-tenant isolation, PR creation, and review workflows.
