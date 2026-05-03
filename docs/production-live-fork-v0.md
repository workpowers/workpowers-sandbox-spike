# Production Live Fork v0

## Current System Shape

The production-shaped v0 path is profile-driven and target-app scoped:

- A checked-in `*.workpowers.livefork.yml` profile describes repo checkout, runtime resources, install/setup commands, services, health checks, required env, data provider, and browser checks.
- Private GitHub checkout uses the org's GitHub App installation; there is no `WORKPOWERS_GITHUB_TOKEN` fallback for normal production-app sessions.
- Target app Neon credentials are stored as org-owned encrypted credentials and referenced through app environment records.
- Each managed-data session creates a Neon branch, injects that branch's `DATABASE_URL`, records internal branch metadata, and deletes the branch during explicit stop or TTL cleanup.
- Daytona runs the target app and session daemon from the active `workpowers-daytona-node-playwright-postgres` snapshot.
- Public session responses and boot events are redacted; preview tokens, daemon URLs, GitHub tokens, Neon API keys, and connection strings remain internal.

Ring of Beara is the verified v0 fixture because it exercises private GitHub checkout, Astro/EmDash runtime behavior, Neon branching, page-level browser proof, and parent/fork data isolation. New target apps should follow the same profile and environment shape without hardcoding Ring-specific behavior into the control plane.

## Ring of Beara Neon Setup

The `ringofbeara` profile expects an org-owned app environment named `ringofbeara:staging`.

Local proof context:

- WorkPowers user: `agent@example.com`
- User id: `jFQmUhP74OkuEbpqrwcYIk6NWpLJbibg`
- Organization id: `4fe2301e-16ce-4c21-9346-f18f410d4c38`
- GitHub repository id: `1225479927`
- GitHub grant: `evanfuture/ringofbeara.com`

Create or collect these values from the Neon project dashboard:

- `neonProjectId`: Neon project Settings or project URL/API details.
- `parentBranchId`: the branch id for the branch WorkPowers should fork from, usually the empty `main` branch. Branch ids start with `br-`.
- `databaseName`: the database the target app should connect to.
- `roleName`: the Postgres role the target app should use.
- `pooled`: `true` for a pooled connection URI, `false` for direct.
- `neonApiKey`: a Neon API key that can create/delete branches and retrieve connection URIs for this project. Prefer the narrowest project-scoped organization API key available.

Store it through the control plane:

```bash
curl -X POST http://localhost:8787/app-environments/neon \
  -H 'content-type: application/json' \
  -d '{
    "organizationId": "ORG_ID",
    "userId": "USER_ID",
    "app": {
      "name": "ringofbeara",
      "repoFullName": "evanfuture/ringofbeara.com",
      "defaultBranch": "main",
      "profilePath": "profiles/ringofbeara.workpowers.livefork.yml"
    },
    "environment": {
      "name": "staging",
      "dataConfig": {
        "neonProjectId": "PROJECT_ID",
        "parentBranchId": "BRANCH_ID",
        "databaseName": "DATABASE_NAME",
        "roleName": "ROLE_NAME",
        "pooled": true
      }
    },
    "credential": {
      "label": "ringofbeara:staging",
      "neonApiKey": "NEON_API_KEY"
    }
  }'
```

The control plane must have `WORKPOWERS_SECRET_ENCRYPTION_KEY` set before storing the credential. Target app Neon values are stored on the org-owned app environment and encrypted credential record, not as normal WorkPowers `.env` settings.

The Ring parent branch must also be prepared in the target repo:

- `ringofbeara.com` main includes the WorkPowers proof marker route and scripts.
- The Ring `.env` points at the Neon parent branch.
- `npm run db:proof:setup` creates the parent marker row.
- EmDash setup is initialized on the parent branch so forked app routes render normally instead of the setup shell.

The parent marker should read:

```txt
id: ringofbeara-parent-marker
status: parent
updated_by: parent-setup
```

## Daytona Snapshot

The Daytona runtime now expects the custom snapshot named `workpowers-daytona-node-playwright-postgres` by default.

Check snapshot availability:

```bash
npm run daytona:snapshot:status
```

Create it:

```bash
npm run daytona:snapshot
```

Current finding on 2026-04-30: the snapshot exists and is active with 2 CPU, 4 GB memory, and 10 GB disk.

## Verified On 2026-04-30

- `npm run daytona:snapshot` created the custom snapshot.
- `npm run daytona:snapshot:status` reported `workpowers-daytona-node-playwright-postgres` as active.
- `npm run daytona:private-clone:smoke` created a Daytona sandbox from the snapshot, cloned `evanfuture/ringofbeara.com` with an org GitHub App installation token, reset `origin` to the clean non-tokenized URL, and deleted the sandbox.
- A control-plane Daytona session using `workpowers.livefork.yml` booted the spike app through the profile path.
- The spike profile session passed in-sandbox Playwright.
- Daemon-routed file read, file write, and git diff were verified.

## Verified On 2026-05-01

- The Ring of Beara Neon environment was stored through the control UI using the org-owned encrypted credential path.
- Session `sess_w7uJyy6grP` loaded `profiles/ringofbeara.workpowers.livefork.yml`, resolved org GitHub App access for `evanfuture/ringofbeara.com`, and cloned the private repo in Daytona sandbox `fbd7bcea-5530-4c80-872b-738fc0134a52`.
- The session created Neon branch `br-proud-haze-anua4u2v` with endpoint `ep-wispy-paper-anfvt1ul`.
- The injected `DATABASE_URL` resolved to the session endpoint host `ep-wispy-paper-anfvt1ul-pooler.c-6.us-east-1.aws.neon.tech`.
- Astro booted from the profile command on port `4321`, and WorkPowers returned Daytona preview URL `https://4321-sjhb7fiqh9oneaua.daytonaproxy01.eu`.
- `POST /sessions/sess_w7uJyy6grP/playwright` ran in the sandbox and passed with exit code `0`, returning page title `EmDash Admin`.
- Explicit stop marked the Daytona sandbox stopped and deleted Neon branch `br-proud-haze-anua4u2v`.
- TTL cleanup uses the same runtime stop and `cleanupDataBranch` path as explicit stop; this was verified by code path, not by waiting for wall-clock expiry.

## Verified Data Isolation On 2026-05-01

- Ring main was updated with the WorkPowers proof marker harness:
  - `0156e71 feat: add WorkPowers fork proof marker`
  - `8b94e73 fix: load env before configuring emdash`
- The Ring parent Neon branch was initialized with EmDash setup and the proof marker.
- WorkPowers session `sess_V4rYACxyS7` cloned Ring commit `8b94e73`.
- The session created Neon branch `br-noisy-heart-an70h5iz` with endpoint `ep-empty-moon-anmes4bf`.
- `npm run db:proof:read` inside the sandbox read the inherited marker from `ep-empty-moon-anmes4bf-pooler.c-6.us-east-1.aws.neon.tech` with `status: parent`.
- `/workpowers/fork-proof` rendered through the Daytona preview and showed the inherited parent marker.
- `npm run db:proof:mutate -- Changed inside WorkPowers fork sess_V4rYACxyS7` changed only the fork marker to `status: fork-mutated`.
- `/workpowers/fork-proof` then rendered the fork mutation.
- The local Ring parent branch still read `status: parent` from `ep-crimson-art-ane5o3ml-pooler.c-6.us-east-1.aws.neon.tech`.
- Explicit stop deleted Neon branch `br-noisy-heart-an70h5iz`.

## Verified Claude Code AgentRun On 2026-05-02

- The Daytona snapshot `workpowers-daytona-node-playwright-postgres` was rebuilt with `node-pty` native build dependencies and `@anthropic-ai/claude-code@2.1.126`, then verified active.
- Session `sess_km-KEk3GfA` loaded `profiles/ringofbeara.workpowers.livefork.yml`, cloned `evanfuture/ringofbeara.com`, and booted Daytona sandbox `796f949d-36a5-4a2b-8c89-ef9b69589252`.
- The session created Neon branch `br-weathered-frost-anqcccrg` with endpoint `ep-bitter-unit-anxw2ovh`.
- The session daemon started in the sandbox and hosted PTY-backed Claude Code runs through the control-plane `AgentRun` API.
- AgentRun `arun_vo2ePfOcKQ` launched Claude Code from `ANTHROPIC_API_KEY` with `--output-format stream-json --verbose`, streamed terminal events, edited `src/pages/workpowers/fork-proof.astro`, and exited `0`.
- Claude Code changed the proof page heading from `WorkPowers Fork Proof` to `WorkPowers Live Fork Proof`. Its `astro check` invocation completed but reported 21 pre-existing type errors in unrelated Ring pages; `src/pages/workpowers/fork-proof.astro` produced no errors.
- The first run also generated collateral changes in `emdash-env.d.ts` and `pnpm-lock.yaml`. AgentRun `arun_UOs4lReQid` cleaned the result so the final diff contained only the intended proof-page heading change.
- `POST /sessions/sess_km-KEk3GfA/playwright` passed with exit code `0`, returning page title `Ring of Beara`.
- `GET /sessions/sess_km-KEk3GfA/diff` returned the expected single-file diff after cleanup.
- Explicit stop marked the Daytona sandbox stopped and deleted Neon branch `br-weathered-frost-anqcccrg`.
