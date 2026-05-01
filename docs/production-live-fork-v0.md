# Production Live Fork v0

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
