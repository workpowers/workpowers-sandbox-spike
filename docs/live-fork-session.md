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
- The session daemon exists but was not yet used as the command path; the control plane still called Daytona's process API directly.

## Next Hardening Pass

- Replace in-memory session state with durable storage.
- Move `pnpm install` and `playwright install` into a Daytona template image.
- Replace command strings with a small in-sandbox daemon client.
- Store preview auth token metadata separately from the public API response when using private previews.
- Add TTL cleanup and idle timeout enforcement.
- Add a managed database branch/snapshot mode after the local seed mode is proven.
- Add private repo checkout through GitHub App tokens or short-lived deploy credentials.
- Add a small WorkPowers control UI so the proof is visible without reading logs.
