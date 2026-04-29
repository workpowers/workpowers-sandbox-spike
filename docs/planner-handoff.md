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

- A warmed Daytona template or warm pool.
- Production-shaped database snapshotting or database branching.
- Private repo checkout without making the repo public.
- Auth or multi-tenant isolation.
- PR creation or review workflows.

## Repeatable Session v0 Verification

On 2026-04-29, the next pass verified the repeatable-session machine against Daytona using the image fallback path.

The verified session was:

- Session id: `sess_3YbNP_dxOv`
- Daytona sandbox id: `e3fc48dc-4db8-408d-9982-21abaecc829e`
- Repo: `https://github.com/workpowers/workpowers-sandbox-spike.git`
- Preview URL: Daytona EU proxy for port `3000`
- Resource profile: 2 CPU, 4 GB memory, 10 GB disk
- Runtime path: `LIVE_FORK_TEMPLATE_IMAGE=mcr.microsoft.com/playwright:v1.59.1-noble`

What was verified:

- `POST /sessions` returned immediately with a `starting` session.
- Boot events progressed through `creating_sandbox`, `cloning_repo`, `installing_dependencies`, `starting_daemon`, `starting_database`, `running_migrations`, `seeding_data`, `starting_api`, `starting_frontend`, `checking_health`, and `ready`.
- The in-sandbox session daemon started and passed health checks.
- Control-plane file read/write, diff export, and Playwright used daemon endpoints after boot.
- A sandbox edit changed `Playwright local` to `Playwright Daytona`.
- `GET /sessions/:id/diff` returned the expected sandbox git diff.
- The first Playwright run failed after an intentionally breaking heading edit, which proved Playwright saw the edited app. After changing to a non-breaking edit, Playwright passed inside the Daytona sandbox.
- The separate control UI showed session boot events, preview URL, actions, diff/log controls, and stable session selection.

What remains unverified:

- Warm snapshot creation and snapshot-speed startup. The key used for verification could create sandboxes, but `pnpm daytona:snapshot` returned `403 Access denied`.
- TTL cleanup against an actually expired Daytona session. The code path is implemented and unit tested, but the live run did not wait for expiry.

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

### Snapshot creation needs additional Daytona permission

The v0 implementation includes a Daytona snapshot script and Dockerfile for:

```txt
workpowers-daytona-node-playwright-postgres
```

The verification key could create and delete Daytona sandboxes, but snapshot creation failed with:

```txt
DaytonaAuthorizationError: Access denied
statusCode: 403
errorCode: Forbidden
```

Until the key/org has snapshot creation permission, clear `LIVE_FORK_SNAPSHOT_NAME` and use the image fallback:

```txt
LIVE_FORK_TEMPLATE_IMAGE=mcr.microsoft.com/playwright:v1.59.1-noble
```

That path is slower, but it verified the real session lifecycle, daemon control path, DB boot, preview, file edits, diff export, and in-sandbox Playwright.

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

1. Unblock Daytona snapshot creation for this stack.

   The implementation artifacts exist, but the current key lacks snapshot creation permission. Once permissions are fixed, run `pnpm daytona:snapshot`, set `LIVE_FORK_SNAPSHOT_NAME=workpowers-daytona-node-playwright-postgres`, and compare startup time against the image fallback.

2. Keep hardening the session daemon boundary.

   The v0 control plane now routes post-bootstrap operations through:

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

   Next, add command policy, stronger path limits, structured process logs, and artifact capture.

3. Improve the WorkPowers control UI from demo to operator surface.

   The tiny control UI exists and was verified, but needs clearer active session state, better empty/error states, one-click logs/diff refresh after actions, and a safer stop confirmation.

4. Decide the private-repo checkout strategy.

   Options:

   - GitHub App installation token
   - deploy key per repo/session
   - short-lived HTTPS token
   - pre-cloned template/snapshot for first-party repos

5. Keep database mode simple for the next iteration.

   Continue with local sandbox Postgres + seed script until the collaboration loop feels good. Add Neon/Supabase branching only after the Live Fork lifecycle is smooth.

6. Finish cleanup and key handling.

   Session records now persist in `.workpowers/sessions.json`, and TTL cleanup is implemented. Next, verify TTL cleanup against an expired Daytona session and rotate any keys that were shared outside normal secret channels.

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
