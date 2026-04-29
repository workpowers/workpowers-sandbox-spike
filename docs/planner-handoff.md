# Live Fork Spike Handoff

## Summary

We proved the core WorkPowers Live Fork heartbeat using a real Daytona sandbox.

The successful run used:

- GitHub repo: `https://github.com/workpowers/workpowers-sandbox-spike.git`
- Daytona region: EU organization default
- Daytona base image: `mcr.microsoft.com/playwright:v1.59.1-noble`
- Sandbox resources: 2 CPU, 4 GB memory, 10 GB disk
- App: React/Vite, Better Auth, Postgres, Drizzle, Playwright
- DB mode: local Postgres inside the sandbox with seed data

The working session returned a Daytona preview URL for port `3000`, ran the app inside the sandbox, ran Playwright inside the same sandbox against `http://localhost:3000`, edited a React component in the sandbox filesystem, hot-reloaded the preview, and exported a git diff.

## What This Proves

- WorkPowers can programmatically create a real sandbox-backed Live Fork Session.
- The sandbox can clone a repo, install dependencies, start Postgres, migrate, seed, and run an app.
- A human can view the sandbox app through a Daytona preview URL.
- The agent/browser lane can use `localhost:3000` inside the sandbox.
- Playwright can run inside the sandbox and interact with authenticated, DB-backed app state.
- WorkPowers can edit code inside the sandbox and see Vite hot reload.
- WorkPowers can fetch logs and export the sandbox git diff.
- The session can be stopped/deleted through the control plane.

This is enough to validate the product heartbeat:

```txt
real sandbox
real repo clone
real DB
real running app
real preview URL
real Playwright inside the box
real code edit
real hot reload
real diff export
```

## What It Does Not Prove Yet

- A polished WorkPowers control UI.
- A warmed Daytona template or warm pool.
- Production-shaped database snapshotting or database branching.
- Private repo checkout without making the repo public.
- Agent interaction through the in-sandbox session daemon.
- Durable session persistence, TTL cleanup, auth, or multi-tenant isolation.
- PR creation or review workflows.

## Key Findings

### Public repo was needed for the first run

The first Daytona clone failed while the GitHub repo was private:

```txt
fatal: could not read Username for 'https://github.com': No such device or address
```

For the first proof, making the repo public was the fastest path. A production path needs GitHub app tokens, deploy keys, or short-lived clone credentials injected per session.

### Daytona default sandbox is too small for this stack

The default TypeScript sandbox created successfully and ran the app, but Vite was killed with exit code `137` after dependency optimization. That points to an out-of-memory kill.

The successful run used an image-based sandbox with:

```txt
cpu: 2
memory: 4
disk: 10
```

Daytona rejected `20 GB` disk for this org:

```txt
Disk request 20GB exceeds maximum allowed per sandbox (10GB).
```

### Resources require image mode

Daytona rejected resource settings on the default snapshot path:

```txt
Cannot specify Sandbox resources when using a snapshot
```

The spike switched to the Playwright image:

```txt
mcr.microsoft.com/playwright:v1.59.1-noble
```

That allowed resource requests and also moves us closer to the desired warm-template direction.

### Global pnpm/Corepack does not work in the default sandbox user

The default sandbox user could not create Corepack shims in `/usr/bin`:

```txt
EACCES: permission denied, symlink ... -> '/usr/bin/pnpm'
```

The provider now runs pnpm through:

```bash
npx --yes pnpm@10.29.1 ...
```

This is acceptable for the cold spike but should be baked into a template.

### Postgres bootstrap needs to handle root and non-root sandboxes

The default TypeScript sandbox runs as a non-root `daytona` user. The Playwright image runs as `root`.

The bootstrap script now supports both:

- non-root: install Postgres tools, initialize a user-owned data dir, use `/tmp` for the Unix socket
- root image: use the packaged Postgres cluster with `pg_ctlcluster`, then create the `workpowers` role/database

## Recommended Next Decisions

1. Build a proper Daytona template/snapshot for this stack.

   Include Node, pnpm, git, Playwright browsers, Postgres/Postgres client tools, the session daemon, and common package cache. This is the difference between a cool demo and a constant-use product.

2. Move control from Daytona process commands to the session daemon.

   The daemon exists in the repo, but the successful run still used Daytona's process API directly. Next pass should start the daemon and route WorkPowers operations through:

   ```txt
   /run-command
   /read-file
   /write-file
   /git-diff
   /logs
   /start-process
   /stop-process
   /run-playwright
   /health
   ```

3. Add a tiny WorkPowers control UI.

   The current visible UI is only the sample forked app. The useful demo should show:

   ```txt
   Start session
   Preview URL
   Run Playwright
   Edit component text
   Show logs
   Show diff
   Stop session
   ```

4. Decide the private-repo checkout strategy.

   Options:

   - GitHub App installation token
   - deploy key per repo/session
   - short-lived HTTPS token
   - pre-cloned template/snapshot for first-party repos

5. Keep database mode simple for the next iteration.

   Continue with local sandbox Postgres + seed script until the collaboration loop feels good. Add Neon/Supabase branching only after the Live Fork lifecycle is smooth.

6. Add cleanup and key handling.

   Persist session records, enforce TTL/idle cleanup, and rotate the Daytona API key used for this spike because it was pasted into chat.

## Suggested Next Milestone

Build the first visible WorkPowers demo loop:

```txt
1. User clicks "Start Live Fork".
2. WorkPowers claims/creates a Daytona sandbox from a warm template.
3. The app preview URL appears.
4. User clicks "Run browser check".
5. Playwright runs inside the sandbox and reports pass/fail.
6. User asks/commands "change dashboard heading".
7. The session daemon edits the file.
8. The preview hot reloads.
9. WorkPowers shows logs and git diff.
10. User clicks "Stop session".
```

That milestone would turn the mechanism proof into something planners, designers, and engineers can all understand by looking at the same screen.
