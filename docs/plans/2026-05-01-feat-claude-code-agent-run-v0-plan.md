---
title: "feat: Claude Code AgentRun v0"
type: feat
status: completed
date: 2026-05-01
---

# feat: Claude Code AgentRun v0

## Overview

Add the first real coding agent participant to a WorkPowers live fork by running Claude Code inside the live fork sandbox through a PTY. The user should be able to start a Ring of Beara live fork, launch a Claude Code agent run inside that fork, watch the terminal stream, steer the agent, inspect the preview, run checks, view the diff, and stop the session with Neon cleanup.

This is not a plan to build a general WorkPowers agent harness. WorkPowers owns the shared application reality: runtime, preview, fork database, browser access, logs, diffs, artifacts, identity, credentials, and lifecycle. Claude Code is the first CLI harness adapter hosted inside that reality.

## Product Goal

Prove the "better Replit" loop for one production-shaped app:

```txt
human opens live fork preview
human starts Claude Code
Claude Code works in the same repo and fork DATABASE_URL
terminal streams live
preview changes as files/data change
checks run inside the fork
diff/logs/artifacts are visible
stop cleans up Daytona and Neon
```

The milestone is successful when a user can ask Claude Code to make a small visible change to `ringofbeara.com`, observe the terminal and preview while it works, see a clean diff, and verify the parent Neon branch remains untouched.

## Prior Art

The earlier `~/Projects/workpowers/wrkpwrs` prototype proved the UX shape:

- `platform/pty-server/server.mjs` used `node-pty` plus WebSocket relay to stream a real shell.
- `components/projects/ProjectTerminal.tsx` used xterm.js, fit handling, reconnects, resize messages, and web links.
- `docs/plans/2026-03-04-phase3-pty-plan.md` framed chat, terminal, and preview as three independent views converging on the filesystem.
- The prototype also revealed risks: prompt-marker completion detection is brittle, WebSocket auth was optional, and the container ran as root with broad Claude Code permissions.

Carry forward the PTY and xterm pattern. Do not carry forward Convex polling or the combined "PTY server plus bridge plus harness" process shape.

## Key Decisions

- Use Claude Code as the first v0 harness adapter.
- Keep the product primitive as `LiveForkSession`.
- Add `AgentRun` as a child of a live fork session.
- Add PTY support to the WorkPowers session daemon, not to the Daytona provider directly.
- Keep the daemon as the in-sandbox capability boundary for terminals, commands, file IO, logs, diff, and Playwright.
- Stream terminal output through WorkPowers-controlled session endpoints.
- Keep the adapter generic enough that Pi or another CLI harness can be added later without rewriting live fork runtime.
- Track process exit as the v0 completion signal. Do not depend on shell prompt markers.
- Let the user stop the agent run without stopping the live fork.
- Let the user stop the whole live fork and clean up runtime/data even if an agent run is active.

## Non-Goals

- Do not build a full custom agent harness.
- Do not implement multi-harness selection UI beyond a hidden/default `claude-code` adapter.
- Do not add PR creation or promotion in this milestone.
- Do not attempt durable replay of every terminal frame beyond an event log sufficient for v0 observability.
- Do not generalize beyond the existing Daytona plus Neon Ring of Beara proof.
- Do not require meaningful Ring production data; the proof marker remains enough for data isolation.

## Target User Flow

1. User starts a live fork from `profiles/ringofbeara.workpowers.livefork.yml`.
2. Boot reaches `ready`; preview URL is visible.
3. User clicks `Start Agent`.
4. User enters a task such as: "Update the WorkPowers fork proof page copy and verify the page still renders."
5. WorkPowers creates an `AgentRun` using the `claude-code` adapter.
6. The daemon starts a PTY process in the session workdir.
7. Terminal output streams into the control UI.
8. User can send follow-up stdin or interrupt with stop.
9. Claude Code edits/runs commands inside the live fork.
10. User opens preview, runs Playwright/check command, views logs and diff.
11. User stops the agent run or the entire session.
12. Session stop deletes the Daytona sandbox and Neon branch.

## Architecture

```txt
Browser
  control UI
    preview iframe
    terminal pane
    agent run controls
    logs/diff/checks

Control Plane
  sessions
  agent runs
  terminal stream proxy
  credential resolution/redaction
  lifecycle/cleanup

Daytona Sandbox
  target app repo
  fork DATABASE_URL
  app services
  session daemon
    command/file/log/diff/playwright endpoints
    terminal/PTY endpoints
    agent run process hosting

Claude Code
  runs as CLI process inside PTY
  cwd = live fork repo
  sees fork app env and allowed harness env
```

## Data Model

Extend `LiveForkSession` with optional agent run artifacts but keep agent runs as first-class records in the session store.

```ts
type AgentHarnessId = "claude-code";

type AgentRunStatus =
  | "starting"
  | "running"
  | "stopping"
  | "completed"
  | "failed"
  | "stopped";

type AgentRun = {
  id: string;
  sessionId: string;
  harness: AgentHarnessId;
  terminalId: string;
  status: AgentRunStatus;
  prompt: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  exitCode?: number | null;
  error?: string;
};
```

For v0, persist agent runs in `.workpowers/sessions.json` alongside sessions. If this grows awkward, split into `.workpowers/agent-runs.json` later.

## Daemon API

Add PTY primitives to `apps/session-daemon`.

```txt
POST   /terminals
GET    /terminals/:id
GET    /terminals/:id/events
POST   /terminals/:id/stdin
POST   /terminals/:id/resize
POST   /terminals/:id/kill
```

Suggested request/response shapes:

```ts
type CreateTerminalRequest = {
  command?: string;              // default shell
  args?: string[];
  cwd?: string;                  // relative to live fork workdir
  env?: Record<string, string>;  // allowlisted by daemon/control plane
  cols?: number;
  rows?: number;
  kind?: "shell" | "agent";
};

type TerminalEvent =
  | { seq: number; type: "output"; data: string; timestamp: string }
  | { seq: number; type: "exit"; exitCode: number | null; signal?: string; timestamp: string }
  | { seq: number; type: "error"; message: string; timestamp: string };
```

Use Server-Sent Events for `/events` if easiest through the control plane. Use WebSockets if the UI needs lower-latency bidirectional terminal interaction immediately. The old xterm client already expects WebSockets, but SSE plus `stdin` POST is acceptable for the first narrow proof if simpler.

## Control Plane API

Add session-scoped agent run endpoints:

```txt
POST /sessions/:id/agent-runs
GET  /sessions/:id/agent-runs
GET  /sessions/:id/agent-runs/:runId
POST /sessions/:id/agent-runs/:runId/stdin
POST /sessions/:id/agent-runs/:runId/stop
GET  /sessions/:id/agent-runs/:runId/events
```

`POST /sessions/:id/agent-runs`:

```json
{
  "harness": "claude-code",
  "prompt": "Update the fork proof page copy and verify it renders."
}
```

The control plane should:

- validate the session exists and is `running`
- create an `AgentRun`
- resolve the `claude-code` adapter
- call the daemon to create a PTY process
- store `terminalId`
- stream terminal events back to the UI
- update status on terminal exit

## Claude Code Adapter

Represent Claude Code as an adapter, not as hardcoded control-plane behavior.

```ts
type AgentHarnessAdapter = {
  id: "claude-code";
  label: "Claude Code";
  command: string;
  argsForPrompt(prompt: string, run: AgentRun): string[];
  envForRun(run: AgentRun): Record<string, string>;
};
```

Initial invocation should be verified before implementation. The likely shape is one of:

```bash
claude -p "$WORKPOWERS_AGENT_PROMPT" --output-format stream-json
```

or:

```bash
claude -p "$WORKPOWERS_AGENT_PROMPT" --output-format json
```

Prefer an output mode that still gives rich terminal visibility. If Claude Code's structured output suppresses the interactive UI too much, run the normal interactive CLI in the PTY and treat terminal output as the primary artifact.

## Claude Code Auth And Secrets

Claude Code needs a harness credential. Treat this separately from target app credentials.

For v0:

- Add a WorkPowers-owned `CLAUDE_CODE_API_KEY` or `ANTHROPIC_API_KEY` source for agent runs.
- Inject it only into the agent process environment, not into target app `.env`.
- Redact it from command output, terminal event persistence, logs, boot events, and public API responses.
- Do not write it into the target repo.

Later:

- Store harness credentials as org-owned credentials, similar to target Neon credentials.
- Support per-org or per-user harness accounts.
- Add credential revocation and audit.

## Runtime Snapshot Changes

Update `infra/daytona/workpowers-daytona-node-playwright-postgres.Dockerfile`:

- install `python3`, `make`, and `g++` for `node-pty` native build if needed
- install or bundle `node-pty` dependencies with `apps/session-daemon`
- install Claude Code CLI or make its installation part of the snapshot build
- keep Playwright, pnpm, git, curl, and Postgres tools

Then recreate and verify the Daytona snapshot:

```bash
npm run daytona:snapshot
npm run daytona:snapshot:status
```

The first implementation may use image fallback only if snapshot creation is blocked, but the intended runtime is still the named snapshot.

## Session Daemon Implementation Notes

Current daemon uses `child_process.exec` for commands and `spawn` for background processes. PTY support should use `node-pty` rather than plain `spawn`.

Implementation details:

- Maintain a `terminalTable` map keyed by terminal id.
- Keep an in-memory ring buffer of terminal events.
- Enforce `safePath` for terminal cwd.
- Default cwd to `LIVE_FORK_WORKDIR`.
- Support resize.
- Support kill with graceful `SIGTERM`/Ctrl+C, then stronger termination if needed.
- Push terminal exit events into both terminal event log and daemon logs.
- Cap terminal event memory to avoid unbounded growth.
- Redact known secrets before returning persisted/logged events.

Do not remove the existing command/file/log/diff/Playwright endpoints.

## Control UI Implementation Notes

Reuse the older xterm pattern from `wrkpwrs`:

- `@xterm/xterm`
- `@xterm/addon-fit`
- `@xterm/addon-web-links`
- reconnect behavior
- resize messages

Add a compact Agent panel to `apps/control-ui`:

- prompt textarea
- `Start Agent` button
- status badge
- `Stop Agent` button
- terminal pane
- link to refresh logs/diff/checks

For v0, do not over-design chat. The terminal stream is the real experience. The prompt box starts the run, and stdin/follow-up can be direct terminal input.

## Safety

Minimum safety requirements:

- session must be running before starting an agent run
- stop agent does not necessarily stop session
- stop session kills active terminals before deleting sandbox/data branch
- terminal event output is redacted before API responses
- daemon URL and preview tokens stay internal
- agent process cwd is constrained to the live fork workdir
- app `.env` continues to receive only target app session env such as fork `DATABASE_URL`
- harness secret does not get written to app `.env`
- terminal event buffers are bounded
- control plane rejects terminal/agent actions for stopped sessions

V0 can keep broad Claude Code repo permissions because the sandbox is ephemeral and data is forked. It should not run as root if this is easy to avoid in the snapshot.

## Testing Plan

Unit tests:

- terminal registry creates, writes, resizes, and kills PTY sessions
- terminal cwd cannot escape live fork workdir
- agent run status transitions from `starting` to `running` to terminal exit state
- stopped sessions reject new agent runs
- terminal/agent logs redact configured secrets
- session stop handles active agent runs

Integration smoke:

- create Ring of Beara session
- start Claude Code agent run with a tiny task
- observe terminal events
- verify diff is non-empty
- run profile Playwright check
- stop agent run
- stop session
- verify Neon branch deleted

Manual proof script:

```txt
1. Start Ring of Beara live fork.
2. Start Claude Code with: "Change the WorkPowers proof page heading text only."
3. Watch terminal output stream.
4. Open preview and verify heading changed.
5. Run Playwright/profile check.
6. Show git diff.
7. Stop session.
8. Confirm parent Neon marker still reads parent.
```

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

## Proof Results

Verified on 2026-05-02 with Ring of Beara session `sess_km-KEk3GfA`:

- Daytona sandbox `796f949d-36a5-4a2b-8c89-ef9b69589252` booted from the rebuilt snapshot and reached `ready`.
- Neon branch `br-weathered-frost-anqcccrg` and endpoint `ep-bitter-unit-anxw2ovh` were created for the fork.
- AgentRun `arun_vo2ePfOcKQ` launched Claude Code 2.1.126 in a PTY, streamed terminal events, edited the proof page, and exited `0`.
- Claude Code ran `astro check`; the command executed successfully but reported 21 pre-existing unrelated Ring type errors. The edited `src/pages/workpowers/fork-proof.astro` file produced no errors.
- AgentRun `arun_UOs4lReQid` cleaned collateral generated-file changes so the final diff contained only the intended heading edit.
- `POST /sessions/sess_km-KEk3GfA/playwright` passed with exit code `0` and title `Ring of Beara`.
- `GET /sessions/sess_km-KEk3GfA/diff` returned a single-file diff for `src/pages/workpowers/fork-proof.astro`.
- Explicit stop deleted Neon branch `br-weathered-frost-anqcccrg`.

See `docs/production-live-fork-v0.md` for the detailed proof log.

## Open Questions

- Resolved: Claude Code invocation uses `claude --bare --permission-mode bypassPermissions -p <prompt> --output-format stream-json --verbose --include-partial-messages`.
- Resolved: `ANTHROPIC_API_KEY` is sufficient for Daytona one-shot CLI mode.
- Resolved for v0: terminal streaming is proxied through the control plane via SSE.
- Resolved for v0: terminal events stay in an in-memory daemon ring; `AgentRun` summaries persist with sessions.
- Resolved for v0: app services and agent processes run as a non-root workspace user when the Daytona image provides one.

## Implementation Order

1. Verify Claude Code CLI behavior in a disposable Daytona sandbox.
2. Add `node-pty` and PTY primitives to the session daemon.
3. Add control-plane daemon client methods for terminal operations.
4. Add `AgentRun` types/store updates and control-plane endpoints.
5. Add Claude Code adapter and harness env injection/redaction.
6. Add control-ui Agent panel and terminal pane.
7. Update Daytona snapshot and recreate it.
8. Run the Ring of Beara proof.
9. Document proof results and remaining gaps.
