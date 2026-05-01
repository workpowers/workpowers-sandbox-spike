---
status: complete
priority: p1
issue_id: "001"
tags: [live-fork, daytona, neon, github-app]
dependencies: []
---

# Production-App Live Fork v0

## Problem Statement

WorkPowers needs to move from the repeatable spike app to a production-shaped live fork of `evanfuture/ringofbeara.com`, using org-owned GitHub App checkout, an org-owned Neon target-app environment, profile-driven boot commands, daemon-routed operations, and cleanup for both runtime and data branches.

## Findings

- The GitHub App repo access foundation already exists and should be reused.
- The current Daytona provider still hardcodes spike-app install, DB bootstrap, API/frontend commands, health checks, and local Postgres env.
- Live fork sessions currently accept user/org request fields but do not persist first-class session ownership fields.
- There is no target app/app environment/credential schema yet.
- Daytona snapshot creation previously failed with `403 Access denied`; the implementation should keep snapshots as the intended runtime path and make the failure actionable rather than silently drifting to image fallback.

## Proposed Solutions

- Option A: Implement a profile path alongside the existing spike path, then gradually converge. Lower risk, but leaves duplicated boot flow.
- Option B: Make both spike and ringofbeara use profiles now. Higher initial touch count, but directly proves the product primitive.

## Recommended Action

Implement Option B in scoped layers: database model and setup API, profile schema/parser, runtime split helpers, Neon provider, then Daytona profile boot and cleanup. Keep the existing GitHub App resolver untouched except for consumption from the profile flow.

## Acceptance Criteria

- [x] Live fork sessions carry `createdByUserId` and `organizationId`.
- [x] Target app and app environment records can be stored for `ringofbeara.com`.
- [x] An org-owned Neon API credential can be stored encrypted at rest and referenced by app environment setup.
- [x] `workpowers.livefork.yml` can describe the spike app.
- [x] Profile-driven Daytona boot preserves the existing spike path.
- [x] Neon branches are created per managed-data session and deleted on stop/TTL cleanup.
- [x] Sensitive GitHub and Neon values are redacted from persisted/public session state.
- [x] Unit/type tests cover profile parsing, environment resolution, Neon request construction, session typing, and redaction.
- [x] Real Daytona snapshot status is checked and snapshot failures have clear operator guidance.

## Work Log

### 2026-04-30 - Implementation Start

**By:** Codex

**Actions:**
- Pushed the existing committed GitHub App access work from `main`.
- Created `codex/production-app-live-fork-v0`.
- Reviewed the production live fork plan, current session/provider/store code, GitHub App resolver, and Daytona snapshot script.

**Learnings:**
- The current provider is ready for extraction because the daemon boundary is already clean; the brittle part is the hardcoded boot sequence.

### 2026-04-30 - First Implementation Pass

**By:** Codex

**Actions:**
- Added live fork app, environment, and org credential tables plus migration support.
- Added encrypted org-owned Neon credential storage and API-first environment setup.
- Added profile parsing, spike and ringofbeara profile files, profile-driven Daytona boot, Neon branch create/delete, profile-specific Playwright commands, and data cleanup hooks.
- Added Daytona snapshot status tooling and verified the current API key still receives `403 Forbidden` when creating the custom WorkPowers snapshot.
- Ran `npm run check` and `npm test`.

**Learnings:**
- Daytona snapshot listing works with the current credentials, but custom snapshot creation is still unauthorized. The next operational step is enabling snapshot creation for the API key/org or creating `workpowers-daytona-node-playwright-postgres` manually in the Daytona dashboard.

### 2026-04-30 - Daytona Snapshot Unblocked

**By:** Codex

**Actions:**
- Fixed the Daytona snapshot builder PATH so Ubuntu package tools remain available.
- Added a delete helper for failed snapshot records.
- Created `workpowers-daytona-node-playwright-postgres` through Daytona and verified it is active.
- Re-ran `npm run check` and `npm test`.

**Learnings:**
- The Restricted Daytona key needs Sandboxes read/write/delete, Snapshots read/write/delete, and Regions read for this workflow. The snapshot build can take several quiet minutes after Docker reports a successful image build.

### 2026-04-30 - Profile And Private Clone Proof

**By:** Codex

**Actions:**
- Verified the local seeded org has a synced grant for `evanfuture/ringofbeara.com`.
- Verified the GitHub App resolver mints a short-lived installation token without exposing it.
- Added and ran a Daytona private-clone smoke test for `ringofbeara.com`; it cloned through `GIT_ASKPASS`, kept `origin` clean, and deleted the sandbox.
- Booted a Daytona session from `workpowers.livefork.yml`.
- Ran in-sandbox Playwright, daemon-routed file read/write, and git diff on the profile session.
- Patched explicit stop cleanup to tolerate already-missing Daytona sandboxes.

**Learnings:**
- The profile-driven spike path is now a useful regression proof for the runtime split. The remaining product proof needs the org-owned Neon environment values for `ringofbeara:staging`.

### 2026-05-01 - Ring Of Beara Production Proof

**By:** Codex

**Actions:**
- Stored the Ring of Beara Neon environment through the control UI's org-owned encrypted credential path.
- Ran session `sess_w7uJyy6grP` from `profiles/ringofbeara.workpowers.livefork.yml`.
- Verified org GitHub App checkout, Neon branch creation, profile env injection, Astro boot, Daytona preview URL generation, in-sandbox browser check, and explicit runtime/data cleanup.
- Confirmed `DATABASE_URL` points at session endpoint host `ep-wispy-paper-anfvt1ul-pooler.c-6.us-east-1.aws.neon.tech`.
- Fixed profile YAML scalar parsing for shell commands with quoted arguments.
- Fixed session-store persistence so concurrent request updates serialize safely instead of racing on one temp file.

**Learnings:**
- The first profile Playwright command exposed a real parser edge case: mixed unquoted shell text with one quoted argument must preserve the trailing quote.
- Polling status and events concurrently exposed a useful local-store race; serializing writes is necessary even for the v0 JSON-backed store.
- TTL cleanup uses the same provider stop and Neon data cleanup helper as explicit stop, but the production proof did not wait four hours for the wall-clock TTL expiry.
