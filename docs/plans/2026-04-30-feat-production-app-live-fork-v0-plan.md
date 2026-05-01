---
title: "feat: Production-App Live Fork v0"
type: feat
status: active
date: 2026-04-30
---

# feat: Production-App Live Fork v0

## Overview

Build the first production-shaped WorkPowers live fork using `evanfuture/ringofbeara.com` as the target app, Daytona as the runtime, the existing GitHub App installation flow for private checkout, and Neon as the target app's managed Postgres branch provider.

The goal is not arbitrary app support. The goal is to prove that WorkPowers can take one real private app profile and create a temporary running fork with branched code, branched data, a preview URL, in-sandbox browser checks, daemon-routed file operations, diff export, and cleanup of both runtime and data branch.

## Existing Foundation

This plan assumes the auth/org foundation exists in the spike app:

- Better Auth organization plugin.
- GitHub-ready account linking.
- Personal org creation on signup.
- Active organization assignment on sessions.
- Better Auth user/session/account/org/member/invitation tables.
- Org-scoped projects.

This plan also assumes the GitHub App repo access foundation exists:

- GitHub App installations are associated with WorkPowers organizations.
- Repository grants are synced into WorkPowers.
- Live fork session creation can resolve `credentialRef: org:github-app`.
- Private checkout uses short-lived GitHub App installation tokens.
- Checkout tokens are not persisted, exposed, or left in git remotes.

## Motivation

The current spike proves an agentic remote dev sandbox with a seeded local Postgres database. It does not yet prove the core WorkPowers product promise: working with a human and coding agent inside a production-shaped, isolated fork of a real app.

This milestone shifts the center from "boot the known spike app" to "read an app profile and fork a real app."

## Target App

- Repository: `https://github.com/evanfuture/ringofbeara.com`
- Access: private repo access through the WorkPowers GitHub App installation and synced repository grant.
- App shape: simple Astro starter project with room to grow into a dynamic app.
- Data stance: any existing database choice may be replaced.
- V0 expected runtime: `pnpm install`, `pnpm dev --host 0.0.0.0 --port 4321`, health check at `/`.

The exact scripts, package manager, Astro version, and app structure must be discovered after private checkout works.

## Key Decisions

- Keep the top-level product primitive as `LiveForkSession`, not "agent run."
- Add a profile-driven live fork path instead of adding more hardcoded spike-app commands.
- Use the existing org model as the ownership boundary for sessions and integrations.
- Use the completed org-owned GitHub App installation access for private checkout.
- Do not add per-user GitHub tokens or env-backed GitHub tokens for repo access.
- Treat Neon as a target-app integration, not as the WorkPowers control-plane database.
- Do not require operators to put target app Neon project keys or URLs in WorkPowers `.env`.
- Store target app data-fork configuration as WorkPowers org/app environment configuration.
- Keep the spike app as a regression fixture by giving it a profile too.
- Do not build a large credential vault UI in this milestone; build the smallest Neon project connection flow that respects org ownership.

## Neon Product Shape

WorkPowers may run its own control-plane database anywhere. That is separate from the target app's database.

For this milestone, the target app is required to use Neon for branchable data. WorkPowers should store an org-owned connection to the target app's Neon project and use it to create per-session branches.

That means:

- WorkPowers `.env` should contain WorkPowers runtime secrets, not every target app's Neon project secrets.
- A WorkPowers org should connect a Neon project once for a target app/environment.
- Live fork creation should reference that stored app environment and branch from its configured parent branch.
- Any authorized user/agent in the WorkPowers org should be able to start forks without manually setting Neon env vars.
- `DATABASE_URL` should be generated per live fork and injected only into that sandbox.

The v0 connection may be API-first, but it should be product-shaped:

```txt
WorkPowers Org
  -> Target App: ringofbeara.com
    -> App Environment: staging/prod-shaped
      -> Repo: evanfuture/ringofbeara.com via org GitHub App
      -> Data Provider: Neon
      -> Neon Project: configured once
      -> Parent Branch: configured once
```

## Proposed Profile

The repo profile should describe what the app needs, not carry target-project secret values.

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
    environmentRef: ringofbeara:staging

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

### 1. Treat GitHub App Repo Access As Existing Foundation

- Do not rebuild GitHub App installation flow.
- Use the existing GitHub App installation and repository grant tables.
- Use the existing `credentialRef: org:github-app` resolver.
- Keep the existing no-token-leak guarantees:
  - no persisted installation tokens
  - no tokenized git remotes
  - no tokens in logs, boot events, command output, diffs, or API responses
- Keep tests that cover installation lookup, repository access checks, token redaction, and missing-access failure.

### 2. Wire Live Fork Ownership To The Existing Org Model

- Add ownership fields to live fork sessions:
  - `createdByUserId`
  - `organizationId`
- Validate that the requesting user is a member of the target organization when the control plane has access to the app database.
- Scope session listing and session actions by organization once identity is present.
- Keep local/dev mode usable with a seeded personal org, especially `agent@example.com`.

This should use the existing Better Auth tables instead of inventing a second user/org system.

### 3. Add Target App And App Environment Configuration

Add the smallest data model needed to represent a real app that WorkPowers can fork:

```txt
live_fork_apps
  id
  organization_id
  name
  repo_full_name
  github_repository_id
  default_branch
  profile_path
  created_at
  updated_at

live_fork_app_environments
  id
  organization_id
  app_id
  name                 # staging, production-like, etc.
  data_provider        # neon
  data_config          # non-secret provider config
  created_at
  updated_at
```

For `ringofbeara.com`, create one app and one environment:

```txt
app: ringofbeara
environment: staging or production-like
repo: evanfuture/ringofbeara.com
data_provider: neon
```

`data_config` should include non-secret Neon identifiers:

```txt
neon_project_id
parent_branch_id
database_name
role_name
pooled
```

### 4. Add Org-Owned Neon Project Connection

Add the smallest Neon credential/configuration path needed for this milestone.

Do not require `NEON_API_KEY`, `NEON_PROJECT_ID`, `NEON_PARENT_BRANCH_ID`, `NEON_DATABASE_NAME`, or `NEON_ROLE_NAME` in WorkPowers `.env` as the normal path.

Instead:

- Add an API-first setup endpoint or admin form to connect a Neon project to a WorkPowers app environment.
- Store non-secret Neon project configuration on the app environment.
- Store the Neon API key as an org-owned credential or encrypted secret reference.
- The credential should be usable by authorized users/agents in the WorkPowers org.
- The credential should be revocable/replaceable without changing WorkPowers process env.

Suggested credential record:

```txt
org_credentials
  id
  organization_id
  provider            # neon
  label
  source_type         # stored_secret for v0
  secret_ref
  granted_by_user_id
  scopes
  created_at
  updated_at
  revoked_at
```

For a local spike, it is acceptable to use a simple encrypted-at-rest secret store if a full vault is too much. It is not acceptable for the normal implementation path to read target app Neon credentials from WorkPowers `.env`.

The only WorkPowers env var that should be needed for this path is a WorkPowers-owned secret-encryption key if the spike stores encrypted credentials locally.

### 5. Add App Profile Parsing

- Add `workpowers.livefork.yml` support using a structured schema.
- Support profile lookup by request field, repo root file, or local config path.
- Add profile-backed fields to `CreateSessionRequest`.
- Preserve the current spike request shape for compatibility.
- Add a spike-app profile fixture so the existing Daytona proof still runs.
- Allow profiles to reference app environments through `environmentRef`.
- Keep repo access as `credentialRef: org:github-app`.

### 6. Split Runtime Responsibilities

Extract the current provider shape into smaller layers:

- `SandboxRuntime`: low-level Daytona/local sandbox creation, command execution, preview URL creation, file transfer if needed, stop/delete.
- `LiveForkSessionRuntime`: app profile execution, checkout, env writing, data fork creation, daemon boot, service boot, health checks, artifact collection, cleanup.
- Existing `SandboxProvider`: remains the control-plane boundary while internals are split.

This keeps future agent execution from being trapped inside the Daytona provider.

### 7. Use Existing Private GitHub Checkout

- Use the existing profile/request `credentialRef: org:github-app`.
- Resolve repo access through the existing organization GitHub App installation/repository grant flow.
- Treat missing GitHub App installation or missing repo grant as a setup error:
  - `GitHub App is not installed for this organization/repository.`
- Confirm that the installation has enough access to clone `evanfuture/ringofbeara.com`.

### 8. Add Neon Branch Provider

Add a managed data provider that can:

- Resolve the target app environment's Neon configuration and org-owned Neon credential.
- Create a branch under the configured Neon project.
- Create or request a read-write compute endpoint for that branch.
- Retrieve a connection URI for the selected database and role.
- Return `DATABASE_URL` for env injection.
- Record Neon project id, branch id, endpoint id, database name, and role name in internal session metadata.
- Delete the Neon branch during stop/TTL cleanup.

Neon API details to account for:

- Creating a branch can include an endpoint in the request.
- A compute endpoint is required to connect to a branch.
- The connection URI can be retrieved with project id, branch id, database name, and role name.
- `connection_uris` is not guaranteed to be returned in every create-branch response, so use the connection URI endpoint rather than relying only on branch creation output.
- Neon supports organization API keys and project-scoped organization API keys; prefer the narrowest key that can create branches for the target project.

### 9. Inject Session Env

- Generate `.env` from profile requirements and provider outputs.
- Always inject the session-specific `DATABASE_URL`.
- Support generated secrets for simple app requirements.
- Fail early if a required env var cannot be satisfied.
- Redact sensitive values from logs, boot events, and public session responses.

### 10. Boot Services From Profile

- Replace hardcoded `dev:spike-api`, `dev:spike`, `db:migrate`, and `db:seed` assumptions in the production path.
- Start named services from the profile.
- Use profile health checks to decide readiness.
- Return the preview URL for the service marked `preview: true`.
- Keep the daemon as a WorkPowers-managed process even when app services are profile-managed.

### 11. Run Browser Check Inside Sandbox

- For `ringofbeara.com`, start with a minimal Playwright smoke check that visits `/`.
- Allow profile-specific Playwright command when the target repo has tests.
- Preserve existing daemon-routed `POST /sessions/:id/playwright` behavior.

### 12. Cleanup Runtime And Data Fork

- On explicit stop, delete the Daytona sandbox and Neon branch.
- On TTL expiry, run the same cleanup path.
- Mark cleanup failures in boot/events without leaking secrets.
- Keep artifacts after cleanup:
  - git diff
  - logs
  - boot events/timings
  - Playwright result
  - preview metadata

### 13. Operator Visibility

- Extend boot phases to distinguish:
  - profile loading
  - GitHub App repo access resolution
  - Neon app environment resolution
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

- [x] Live fork sessions carry `createdByUserId` and `organizationId`.
- [x] GitHub App repo access is treated as existing foundation and is not reimplemented.
- [x] There is no `WORKPOWERS_GITHUB_TOKEN` or env-backed GitHub checkout path.
- [x] `ringofbeara.com` can be cloned in Daytona using the org's GitHub App installation.
- [x] WorkPowers can store a target app record for `ringofbeara.com`.
- [x] WorkPowers can store an app environment record for the target app's Neon-backed environment.
- [x] WorkPowers can store or reference an org-owned Neon API credential without requiring target app Neon keys in WorkPowers `.env`.
- [x] `workpowers.livefork.yml` can describe the existing spike app.
- [x] The existing spike app still boots through Daytona after the runtime split.
- [x] A Neon branch is created per session.
- [x] `DATABASE_URL` points at the session Neon branch, not production.
- [x] The Astro app boots from profile commands.
- [x] WorkPowers returns a Daytona preview URL for the Astro app.
- [x] In-sandbox browser check passes against the Astro preview target.
- [x] Daemon-routed file read/write and git diff work for the fork.
- [x] Explicit stop deletes both the Daytona sandbox and Neon branch.
- [x] TTL cleanup uses the same runtime and data cleanup path.
- [x] Public session responses and boot events do not expose GitHub or Neon secrets.

## Non-Goals

- Arbitrary app support.
- Additional Organizations and Users work beyond the foundation already landed.
- Full credential vault UI.
- Full secret management platform beyond the minimum needed for an org-owned Neon API credential.
- GitHub App installation flow, because it already exists.
- PR creation/promotion.
- WebRTC or multiplayer collaboration.
- Generalized multi-cloud runtime support.
- Production writes.
- Sophisticated data anonymization.

## Risks And Mitigations

- The auth/org foundation currently lives in the spike app, while the control plane is a separate Express service.
  - Mitigation: v0 may use explicit dev identity fields/headers and shared database access; defer polished control-plane auth middleware.
- Target app Neon credentials can drift into WorkPowers process env if we optimize for speed.
  - Mitigation: require a stored app environment and org-owned Neon credential path for v0; avoid `NEON_*` target app env vars as the normal path.
- A Neon API key can be broader than the specific target app project.
  - Mitigation: prefer Neon project-scoped organization API keys when possible and store the project binding on the app environment.
- Neon branch cleanup can fail after sandbox cleanup succeeds.
  - Mitigation: store Neon branch id in internal metadata before boot continues; make cleanup idempotent.
- `ringofbeara.com` may not have database code yet.
  - Mitigation: first prove branch creation and env injection; optionally add one tiny database-backed health route later.
- Astro defaults to port `4321`; repo scripts may differ.
  - Mitigation: discover scripts after checkout and update the app profile before declaring the milestone verified.
- Current control plane loses Daytona handles on restart.
  - Mitigation: keep this as known v0 limitation unless it blocks cleanup verification; record provider resource IDs for manual recovery.

## Verification

- Run unit tests for profile parsing, session typing, redaction, app environment resolution, and Neon provider request construction.
- Run the auth foundation tests.
- Run GitHub App repo access tests.
- Run the existing local/spike session tests.
- Run a Daytona session for the spike profile.
- Run a Daytona session for `ringofbeara.com` with real GitHub App installation access and a configured Neon app environment.
- Verify preview loads in browser.
- Run Playwright inside the sandbox.
- Edit a file through the daemon and verify diff export.
- Stop the session and confirm the Daytona sandbox and Neon branch are gone.

## Sources

- Existing WorkPowers handoff: `docs/planner-handoff.md`
- Existing session notes: `docs/live-fork-session.md`
- GitHub App repo access docs: `docs/github-app-repo-access.md`
- Neon Create branch API: https://api-docs.neon.tech/reference/createprojectbranch
- Neon Create compute endpoint API: https://api-docs.neon.tech/reference/createprojectendpoint
- Neon Retrieve connection URI API: https://api-docs.neon.tech/reference/getconnectionuri
- Neon Create organization API key API: https://api-docs.neon.tech/reference/createorgapikey
- Neon manage computes docs: https://neon.com/docs/manage/endpoints/
