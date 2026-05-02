---
status: complete
priority: p1
issue_id: "002"
tags: [agent-runs, live-fork, pty, daytona]
dependencies: []
---

# Claude Code AgentRun v0

## Problem Statement

WorkPowers live fork sessions can boot an app, expose preview/log/diff/check endpoints, and clean up Daytona plus Neon resources, but they do not yet host a real coding agent inside the same fork reality. The product proof needs Claude Code running in a PTY inside the session workdir with streamed terminal output, stop controls, and redaction.

## Findings

- The session daemon currently exposes command/file/log/diff/Playwright endpoints and uses `exec`/`spawn`, but has no PTY registry.
- The control plane persists sessions in `.workpowers/sessions.json`; agent runs can be first-class records in that same store for v0.
- Providers already centralize daemon calls, so terminal operations should extend that client/provider boundary.
- The control UI is a compact operator shell and can add an Agent panel without introducing a chat abstraction.

## Proposed Solutions

### Option 1: Add PTY And AgentRun To Existing Session Runtime

**Approach:** Add `node-pty` endpoints in the daemon, provider/client methods, session-store `AgentRun` records, Claude Code adapter, and UI controls.

**Pros:**
- Matches the plan and current architecture.
- Keeps v0 small and local to the existing live fork lifecycle.

**Cons:**
- Terminal event persistence remains bounded and simple.
- Claude Code invocation remains configurable/proof-driven.

**Effort:** 1-2 days

**Risk:** Medium

## Recommended Action

Implement Option 1 with focused tests for daemon terminal behavior, agent run store transitions, redaction, and session stop handling. Verify with typecheck, Vitest, snapshot build/status if possible, and a Ring of Beara proof run.

## Technical Details

**Affected files:**
- `apps/session-daemon/src/server.ts`
- `apps/control-plane/src/server.ts`
- `apps/control-plane/src/providers/*`
- `apps/control-ui/src/main.tsx`
- `packages/live-fork/src/types.ts`
- `packages/live-fork/src/session-store.ts`
- `packages/live-fork/src/schemas.ts`
- `packages/live-fork/src/redaction.ts`
- `infra/daytona/workpowers-daytona-node-playwright-postgres.Dockerfile`
- `docs/plans/2026-05-01-feat-claude-code-agent-run-v0-plan.md`
- `docs/production-live-fork-v0.md`

## Acceptance Criteria

- [x] Daytona snapshot includes everything needed for PTY-backed Claude Code runs.
- [x] Session daemon can create and manage PTY terminals.
- [x] Control plane can create, list, stop, and stream `AgentRun` records.
- [x] Control UI can start a Claude Code run and show the terminal stream.
- [x] User can interrupt or stop an agent run without stopping the live fork.
- [x] Agent can edit files in the Ring of Beara fork.
- [x] User can inspect preview, logs, Playwright result, and diff after the run.
- [x] Session stop kills active agent terminals and deletes the Neon branch.
- [x] Secrets are redacted from terminal events, logs, diffs, and public responses.
- [x] The successful proof is documented in `docs/production-live-fork-v0.md` or a new agent-run proof note.

## Work Log

### 2026-05-02 - Implementation Started

**By:** Codex

**Actions:**
- Read the implementation plan and current daemon/control-plane/UI architecture.
- Confirmed user choices: create a feature branch, track the plan, use `ANTHROPIC_API_KEY`, and run the full proof.

**Learnings:**
- The repo is small enough to keep v0 in the existing session runtime instead of introducing a separate harness service.

### 2026-05-02 - Completed

**By:** Codex

**Actions:**
- Added PTY terminal primitives to the session daemon and wired them through provider/control-plane APIs.
- Added `AgentRun` types, schemas, persistence, redaction, Claude Code adapter, and control UI terminal panel.
- Rebuilt the Daytona snapshot with `node-pty` build dependencies and Claude Code CLI.
- Ran Ring of Beara proof session `sess_km-KEk3GfA` with two completed Claude Code AgentRuns.

**Proof:**
- AgentRun `arun_vo2ePfOcKQ` edited the Ring proof page inside Daytona sandbox `796f949d-36a5-4a2b-8c89-ef9b69589252`.
- AgentRun `arun_UOs4lReQid` cleaned generated collateral so the final diff only changed `src/pages/workpowers/fork-proof.astro`.
- Playwright passed with exit code `0` and title `Ring of Beara`.
- Stop deleted Neon branch `br-weathered-frost-anqcccrg`.

**Learnings:**
- Claude Code needs `--verbose` with `--output-format stream-json`.
- Running app services and agent processes as the non-root workspace user avoids root-owned Vite cache problems.
- Git needs `safe.directory` configured for the daemon after the repo is chowned for non-root agent work.
