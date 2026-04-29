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

## Next Hardening Pass

- Replace in-memory session state with durable storage.
- Move `pnpm install` and `playwright install` into a Daytona template image.
- Replace command strings with a small in-sandbox daemon client.
- Store preview auth token metadata separately from the public API response when using private previews.
- Add TTL cleanup and idle timeout enforcement.
- Add a managed database branch/snapshot mode after the local seed mode is proven.
