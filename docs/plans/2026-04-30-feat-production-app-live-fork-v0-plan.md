---
title: "feat: Production-App Live Fork v0"
type: feat
status: active
date: 2026-04-30
---

# feat: Production-App Live Fork v0

## Overview

Build the first production-shaped WorkPowers live fork using `evanfuture/ringofbeara.com` as the target app, Daytona as the runtime, GitHub App installation access for private checkout, and Neon as the managed Postgres branch provider.

The goal is not arbitrary app support. The goal is to prove that WorkPowers can take one real private app profile and create a temporary running fork with branched code, branched data, a preview URL, in-sandbox browser checks, daemon-routed file operations, diff export, and cleanup of both runtime and data branch.

This plan assumes the auth/org foundation now exists in the spike app:

- Better Auth organization plugin.
- GitHub-ready account linking.
- Personal org creation on signup.
- Active organization assignment on sessions.
- Better Auth user/session/account/org/member/invitation tables.
- Org-scoped projects.

## Motivation

The current spike proves an agentic remote dev sandbox with a seeded local Postgres database. It does not yet prove the core WorkPowers product promise: working with a human and coding agent inside a production-shaped, isolated fork of a real app.

This milestone shifts the center from "boot the known spike app" to "read an app profile and fork a real app."

## Target App

- Repository: `https://github.com/evanfuture/ringofbeara.com`
- Current access: private until the WorkPowers GitHub App is installed on the repository and synced into the active WorkPowers organization.
- App shape: simple Astro starter project with room to grow into a dynamic app
- Data stance: any existing database choice may be replaced
- V0 expected runtime: `pnpm install`, `pnpm dev --host 0.0.0.0 --port 4321`, health check at `/`

The exact scripts, package manager, Astro version, and app structure must be discovered after private checkout works.

## Key Decisions

- Keep the top-level product primitive as `LiveForkSession`, not "agent run."
- Add a profile-driven live fork path instead of adding more hardcoded spike-app commands.
- Use Neon branch creation for the first managed database fork.
- Use the new org model as the ownership boundary for sessions and credentials.
- Use org-owned GitHub App installation access for private checkout. Do not use per-user GitHub tokens or env-backed GitHub tokens for repo access.
- Model GitHub credentials as org-scoped references that mint short-lived installation tokens only at session start.
- Keep the spike app as a regression fixture by giving it a profile too.
- Do not build a large credential vault UI in this milestone; build the smallest credential resolver that respects org ownership.

## Proposed Profile

```yaml
name: ringofbeara

repo:
  provider: github
  owner: evanfuture
  name: ringofbeara.com
  credentialRef: org:github-app

runtime:
  provider: daytona
  image: mcr.microsoft.com/playwright:v1.59.1-noble
  resources:
    cpu: 2
    memoryGb: 4
    diskGb: 10

install:
  command: pnpm install

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
    credentialRef: org:neon:default
    projectIdEnv: NEON_PROJECT_ID
    parentBranchIdEnv: NEON_PARENT_BRANCH_ID
    databaseNameEnv: NEON_DATABASE_NAME
    roleNameEnv: NEON_ROLE_NAME

env:
  required:
    - DATABASE_URL

agent:
  daemon:
    command: pnpm workpowers-daemon
    port: 8790

checks:
  playwright:
    command: pnpm exec playwright test
    targetUrl: http://localhost:4321

lifecycle:
  ttlMinutes: 240
  idleTimeoutMinutes: 45
```

## Implementation Plan

### 1. Wire Live Fork Ownership To The Existing Org Model

- Add ownership fields to live fork sessions:
  - `createdByUserId`
  - `organizationId`
- For v0, allow the control plane to receive explicit dev headers or request fields for `userId` and `organizationId` while full control-plane auth integration is deferred.
- Validate that the requesting user is a member of the target organization when the control plane has access to the app database.
- Scope session listing and session actions by organization once identity is present.
- Keep local/dev mode usable with a seeded personal org, especially `agent@example.com`.

This should use the newly landed Better Auth tables instead of inventing a second user/org system.

### 2. Add Minimal Org-Scoped Credential References

Add the smallest credential abstraction needed for this milestone:

- `credentialRef` format:
  - `org:github-app`
  - `org:neon:default`
  - `env:neon:default`
- GitHub resolver:
  - Look up the active WorkPowers organization's GitHub App installation.
  - Verify the target repository is present in that installation's synced repository grants.
  - Mint a short-lived installation token only for the runtime checkout path.
  - Never persist the token.
- Neon resolver:
  - Use env-backed credentials for v0:
    - `NEON_API_KEY`
    - `NEON_PROJECT_ID`
    - `NEON_PARENT_BRANCH_ID`
    - `NEON_DATABASE_NAME`
    - `NEON_ROLE_NAME`
  - Keep the resolver interface org-scoped so this can later become a stored org credential.
- Never expose credential values in public session responses, boot events, command strings, logs, diffs, or persisted artifacts.

Optional v0 table if the implementation needs an explicit org binding:

```txt
org_credentials
  id
  organization_id
  provider
  label
  source_type        # linked_account | env
  source_ref         # account id or env key name
  granted_by_user_id
  scopes
  created_at
```

For v0, this table may store references only, not raw secrets.

### 3. Add App Profile Parsing

- Add `workpowers.livefork.yml` support using a structured schema.
- Support profile lookup by request field, repo root file, or local config path.
- Add profile-backed fields to `CreateSessionRequest`.
- Preserve the current spike request shape for compatibility.
- Add a spike-app profile fixture so the existing Daytona proof still runs.
- Allow profiles to reference org credentials through `credentialRef`.

### 4. Split Runtime Responsibilities

Extract the current provider shape into smaller layers:

- `SandboxRuntime`: low-level Daytona/local sandbox creation, command execution, preview URL creation, file transfer if needed, stop/delete.
- `LiveForkSessionRuntime`: app profile execution, checkout, env writing, data fork creation, daemon boot, service boot, health checks, artifact collection, cleanup.
- Existing `SandboxProvider`: remains the control-plane boundary while internals are split.

This keeps future agent execution from being trapped inside the Daytona provider.

### 5. Add Private GitHub Checkout

- Resolve the profile's GitHub `credentialRef`.
- Clone private repos over HTTPS with token injection that does not leak into boot events, logs, session JSON, persisted session data, or returned API responses.
- Avoid persisting tokenized remote URLs in session artifacts.
- After clone, rewrite `origin` to the non-tokenized HTTPS URL.
- Treat missing GitHub access as a profile/credential error, not as a generic boot failure.
- Confirm that the granted token has enough access to clone `evanfuture/ringofbeara.com`.

### 6. Add Neon Branch Provider

Add a managed data provider that can:

- Create a branch under `NEON_PROJECT_ID`.
- Create or request a read-write compute endpoint for that branch.
- Retrieve a connection URI for the selected database and role.
- Return `DATABASE_URL` for env injection.
- Record Neon project id, branch id, endpoint id, database name, and role name in internal session metadata.
- Delete the Neon branch during stop/TTL cleanup.

Required v0 environment variables:

```txt
NEON_API_KEY
NEON_PROJECT_ID
NEON_PARENT_BRANCH_ID
NEON_DATABASE_NAME
NEON_ROLE_NAME
```

Neon API details to account for:

- Creating a branch can include an endpoint in the request.
- A compute endpoint is required to connect to a branch.
- The connection URI can be retrieved with project id, branch id, database name, and role name.
- `connection_uris` is not guaranteed to be returned in every create-branch response, so use the connection URI endpoint rather than relying only on branch creation output.

### 7. Inject Session Env

- Generate `.env` from profile requirements and provider outputs.
- Always inject the session-specific `DATABASE_URL`.
- Support generated secrets for simple app requirements.
- Fail early if a required env var cannot be satisfied.
- Redact sensitive values from logs, boot events, and public session responses.

### 8. Boot Services From Profile

- Replace hardcoded `dev:spike-api`, `dev:spike`, `db:migrate`, and `db:seed` assumptions in the production path.
- Start named services from the profile.
- Use profile health checks to decide readiness.
- Return the preview URL for the service marked `preview: true`.
- Keep the daemon as a WorkPowers-managed process even when app services are profile-managed.

### 9. Run Browser Check Inside Sandbox

- For `ringofbeara.com`, start with a minimal Playwright smoke check that visits `/`.
- Allow profile-specific Playwright command when the target repo has tests.
- Preserve existing daemon-routed `POST /sessions/:id/playwright` behavior.

### 10. Cleanup Runtime And Data Fork

- On explicit stop, delete the Daytona sandbox and Neon branch.
- On TTL expiry, run the same cleanup path.
- Mark cleanup failures in boot/events without leaking secrets.
- Keep artifacts after cleanup:
  - git diff
  - logs
  - boot events/timings
  - Playwright result
  - preview metadata

### 11. Operator Visibility

- Extend boot phases to distinguish:
  - profile loading
  - credential resolution
  - private checkout
  - data branch creation
  - env injection
  - daemon boot
  - service boot
  - health checks
  - preview readiness
  - cleanup
- Add timing fields or event duration derivation so the live-fork critical path is measurable.

## Acceptance Criteria

- [ ] Live fork sessions can carry `createdByUserId` and `organizationId`.
- [ ] V0 credential resolution uses the existing Better Auth org/user/account foundation where available, with env fallback for local testing.
- [ ] `workpowers.livefork.yml` can describe the existing spike app.
- [ ] The existing spike app still boots through Daytona after the runtime split.
- [ ] `ringofbeara.com` can be cloned in Daytona using an org-scoped GitHub credential reference.
- [ ] A Neon branch is created per session.
- [ ] `DATABASE_URL` points at the session Neon branch, not production.
- [ ] The Astro app boots from profile commands.
- [ ] WorkPowers returns a Daytona preview URL for the Astro app.
- [ ] In-sandbox browser check passes against the Astro preview target.
- [ ] Daemon-routed file read/write and git diff work for the fork.
- [ ] Explicit stop deletes both the Daytona sandbox and Neon branch.
- [ ] TTL cleanup uses the same runtime and data cleanup path.
- [ ] Public session responses and boot events do not expose GitHub or Neon secrets.

## Non-Goals

- Arbitrary app support.
- Additional Organizations and Users work beyond the foundation already landed.
- Full credential vault UI.
- Secret encryption/key management beyond avoiding raw secret persistence in this spike.
- GitHub App installation flow.
- PR creation/promotion.
- WebRTC or multiplayer collaboration.
- Generalized multi-cloud runtime support.
- Production writes.
- Sophisticated data anonymization.

## Risks And Mitigations

- The auth/org foundation currently lives in the spike app, while the control plane is a separate Express service.
  - Mitigation: v0 may use explicit dev identity fields/headers and shared database access; defer polished control-plane auth middleware.
- Private repo checkout can leak credentials through command text or git remote URLs.
  - Mitigation: centralize credential URL construction, redact command output, reset remote URL after clone if needed.
- A linked GitHub account token may be user-scoped while the session is org-scoped.
  - Mitigation: resolve credentials through an explicit org credential reference, even if it points to a granted user's linked account in v0.
- Neon branch cleanup can fail after sandbox cleanup succeeds.
  - Mitigation: store Neon branch id in internal metadata before boot continues; make cleanup idempotent.
- `ringofbeara.com` may not have database code yet.
  - Mitigation: first prove branch creation and env injection; optionally add one tiny database-backed health route later.
- Astro defaults to port `4321`; repo scripts may differ.
  - Mitigation: discover scripts after checkout and update the app profile before declaring the milestone verified.
- Current control plane loses Daytona handles on restart.
  - Mitigation: keep this as known v0 limitation unless it blocks cleanup verification; record provider resource IDs for manual recovery.

## Verification

- Run unit tests for profile parsing, session typing, redaction, credential resolution, and Neon provider request construction.
- Run the auth foundation tests.
- Run the existing local/spike session tests.
- Run a Daytona session for the spike profile.
- Run a Daytona session for `ringofbeara.com` with real GitHub and Neon credentials.
- Verify preview loads in browser.
- Run Playwright inside the sandbox.
- Edit a file through the daemon and verify diff export.
- Stop the session and confirm the Daytona sandbox and Neon branch are gone.

## Sources

- Existing WorkPowers handoff: `docs/planner-handoff.md`
- Existing session notes: `docs/live-fork-session.md`
- Neon Create branch API: https://api-docs.neon.tech/reference/createprojectbranch
- Neon Create compute endpoint API: https://api-docs.neon.tech/reference/createprojectendpoint
- Neon Retrieve connection URI API: https://api-docs.neon.tech/reference/getconnectionuri
- Neon manage computes docs: https://neon.com/docs/manage/endpoints/
