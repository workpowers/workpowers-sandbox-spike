import "dotenv/config";
import cors from "cors";
import express from "express";
import { nanoid } from "nanoid";
import { z } from "zod";
import { GITHUB_APP_CREDENTIAL_REF, assertOrganizationMembership, resolveGitHubRepoAccess } from "../../spike-app/server/github-app.js";
import { DrizzleLiveForkConfigStore, type ResolvedLiveForkAppEnvironment } from "../../spike-app/server/live-fork-config.js";
import { loadLiveForkProfile, profileRepoUrl, profileToEnv } from "../../../packages/live-fork/src/profile.js";
import { redactCommandResult, redactSecrets } from "../../../packages/live-fork/src/redaction.js";
import { commandSchema, createAgentRunSchema, createSessionSchema, filePathSchema, fileWriteSchema, terminalResizeSchema, terminalStdinSchema } from "../../../packages/live-fork/src/schemas.js";
import { LiveForkSessionStore, redactSession } from "../../../packages/live-fork/src/session-store.js";
import type { AgentRun, LiveForkSession, TerminalEvent } from "../../../packages/live-fork/src/types.js";
import { resolveAgentHarness } from "./agent-harnesses.js";
import { createProvider } from "./providers/index.js";
import { NeonBranchProvider, type NeonBranch } from "./providers/neon-provider.js";
import { createStartingSession, type BootEventRecorder, type NormalizedCreateSessionRequest } from "./providers/provider.js";

const app = express();
const port = Number(process.env.CONTROL_PLANE_PORT ?? 8787);
const store = new LiveForkSessionStore();
const provider = createProvider();
const configStore = new DrizzleLiveForkConfigStore();
const neonProvider = new NeonBranchProvider();

const neonEnvironmentSetupSchema = z.object({
  organizationId: z.string().min(1),
  userId: z.string().min(1),
  app: z.object({
    name: z.string().min(1),
    repoFullName: z.string().min(1),
    githubRepositoryId: z.string().min(1).optional(),
    defaultBranch: z.string().min(1).default("main"),
    profilePath: z.string().min(1).optional()
  }),
  environment: z.object({
    name: z.string().min(1),
    dataConfig: z.object({
      neonProjectId: z.string().min(1),
      parentBranchId: z.string().min(1),
      databaseName: z.string().min(1),
      roleName: z.string().min(1),
      pooled: z.boolean().default(false)
    })
  }),
  credential: z.object({
    label: z.string().min(1).optional(),
    neonApiKey: z.string().min(1),
    scopes: z.array(z.string()).optional()
  })
});

app.use(express.json({ limit: "5mb" }));
app.use(cors());

await store.load();
await store.reconcileActiveSessions();

function sessionSummary(session: LiveForkSession) {
  return {
    sessionId: session.id,
    status: session.sandbox.status,
    bootPhase: session.boot.phase,
    previewUrl: session.app.previewUrl || undefined,
    internalUrl: session.app.internalUrl || undefined,
    expiresAt: session.lifecycle.expiresAt
  };
}

async function requireSession(id: string, touch = true) {
  const session = store.get(id);
  if (!session) return undefined;
  if (touch) await store.touch(id);
  return store.get(id);
}

async function recordLifecycleEvent(sessionId: string, message: string) {
  await store.appendBootEvent(sessionId, {
    phase: "ready",
    status: "completed",
    message
  });
}

function publicAgentRuns(session: LiveForkSession) {
  return session.agentRuns ?? [];
}

function findAgentRun(session: LiveForkSession, runId: string) {
  return publicAgentRuns(session).find((run) => run.id === runId);
}

async function updateAgentRunFromTerminalEvent(sessionId: string, runId: string, event: TerminalEvent) {
  if (event.type !== "exit" && event.type !== "error") return;
  const currentSession = store.get(sessionId);
  if (!currentSession) return;
  const currentRun = findAgentRun(currentSession, runId);
  if (currentRun?.status === "stopped") return;

  const patch: Partial<AgentRun> = {
    completedAt: new Date().toISOString()
  };

  if (event.type === "exit") {
    patch.exitCode = event.exitCode;
    patch.status = event.exitCode === 0 ? "completed" : "failed";
  } else {
    patch.status = "failed";
    patch.error = event.message;
  }

  await store.updateAgentRun(sessionId, runId, patch);
}

async function consumeTerminalEventStream(
  stream: Response,
  onEvent: (event: TerminalEvent) => void | Promise<void>,
  forward?: express.Response
) {
  if (!stream.body) throw new Error("Daemon terminal stream did not include a body.");
  const reader = stream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    if (forward) forward.write(chunk);
    buffer += chunk;

    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const dataLine = frame.split("\n").find((line) => line.startsWith("data: "));
      if (dataLine) {
        const event = JSON.parse(dataLine.slice(6)) as TerminalEvent;
        await onEvent(event);
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
}

function watchAgentRunExit(sessionId: string, runId: string, terminalId: string) {
  void (async () => {
    try {
      const session = store.get(sessionId);
      if (!session) return;
      const stream = await provider.openTerminalEventStream(session, terminalId);
      await consumeTerminalEventStream(stream, async (event) => {
        await updateAgentRunFromTerminalEvent(sessionId, runId, event);
      });
    } catch (error) {
      await store.updateAgentRun(sessionId, runId, {
        status: "failed",
        completedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error)
      });
    }
  })();
}

async function stopActiveAgentRuns(session: LiveForkSession) {
  for (const run of session.agentRuns ?? []) {
    if (!["starting", "running", "stopping"].includes(run.status)) continue;
    await store.updateAgentRun(session.id, run.id, { status: "stopping" });
    await provider.killTerminal(session, run.terminalId).catch(async (error: unknown) => {
      await store.updateAgentRun(session.id, run.id, {
        status: "failed",
        completedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error)
      });
    });
  }
}

async function provisionInBackground(session: LiveForkSession, input: NormalizedCreateSessionRequest) {
  let dataBranch: NeonBranch | undefined;
  let resolvedEnvironment: ResolvedLiveForkAppEnvironment | undefined;

  try {
    const record: BootEventRecorder = async (phase, status, message) => {
      await store.recordBootPhase(session.id, phase, status, message);
    };

    if (input.profile) {
      await record("loading_profile", "completed", `Loaded live fork profile ${input.profile.name}`);
      input = {
        ...input,
        repoUrl: profileRepoUrl(input.profile),
        ref: input.ref === "main" ? "main" : input.ref,
        credentialRef: input.profile.repo.credentialRef
      };
    }

    if (input.credentialRef === GITHUB_APP_CREDENTIAL_REF) {
      await record("resolving_github_access", "running", "Resolving organization GitHub App repository access");
      const repoAccess = await resolveOrgGitHubRepoAccess(input);
      await record("resolving_github_access", "completed", `GitHub App access resolved for ${repoAccess.fullName}`);
      input = { ...input, repoAccess };
    }

    if (input.profile?.data.primary.provider === "neon") {
      const environmentRef = input.profile.data.primary.environmentRef;
      if (!environmentRef) throw new Error(`Profile ${input.profile.name} requires data.primary.environmentRef for Neon.`);
      if (!input.organizationId) throw new Error("organizationId is required to resolve a Neon app environment.");

      await record("resolving_app_environment", "running", `Resolving Neon app environment ${environmentRef}`);
      resolvedEnvironment = await configStore.resolveEnvironment(input.organizationId, environmentRef);
      await record("resolving_app_environment", "completed", `Resolved Neon app environment ${environmentRef}`);

      await record("creating_data_branch", "running", "Creating Neon branch for the live fork session");
      dataBranch = await neonProvider.createBranch({
        sessionId: session.id,
        environment: resolvedEnvironment,
        expiresAt: session.lifecycle.expiresAt
      });
      await store.update(session.id, {
        data: {
          mode: "db_branch",
          provider: "neon",
          branchId: dataBranch.branchId,
          endpointId: dataBranch.endpointId,
          environmentRef
        },
        internal: {
          dataBranch: {
            provider: "neon",
            projectId: dataBranch.projectId,
            branchId: dataBranch.branchId,
            endpointId: dataBranch.endpointId,
            databaseName: dataBranch.databaseName,
            roleName: dataBranch.roleName
          }
        }
      });
      await record("creating_data_branch", "completed", `Neon branch ${dataBranch.branchId} created`);
      input = {
        ...input,
        data: { mode: "db_branch", seedName: input.data.seedName },
        dataBranch: {
          provider: "neon",
          projectId: dataBranch.projectId,
          branchId: dataBranch.branchId,
          endpointId: dataBranch.endpointId,
          databaseName: dataBranch.databaseName,
          roleName: dataBranch.roleName
        },
        sessionEnv: profileToEnv(input.profile, {
          ...(input.sessionEnv ?? {}),
          DATABASE_URL: dataBranch.databaseUrl
        })
      };
    }

    if (input.profile && !input.sessionEnv) {
      input = {
        ...input,
        sessionEnv: profileToEnv(input.profile, {
          DATABASE_URL: "postgres://workpowers:workpowers@localhost:5432/workpowers_live_fork",
          BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret-dev-secret",
          BETTER_AUTH_URL: "http://localhost:3001"
        })
      };
    }

    const provisioned = await provider.create(input, session, record);

    const current = store.get(session.id) ?? provisioned.session;
    await store.update(session.id, {
      sandbox: provisioned.session.sandbox,
      app: provisioned.session.app,
      data: provisioned.session.data,
      lifecycle: {
        ...provisioned.session.lifecycle,
        lastActivityAt: current.lifecycle.lastActivityAt
      },
      resourceProfile: provisioned.session.resourceProfile,
      artifacts: provisioned.session.artifacts,
      internal: provisioned.session.internal
    });
  } catch (error) {
    const message = redactSecrets(error instanceof Error ? error.message : String(error));
    if (dataBranch && resolvedEnvironment) {
      await neonProvider.deleteBranch({
        apiKey: resolvedEnvironment.neonApiKey,
        projectId: dataBranch.projectId,
        branchId: dataBranch.branchId
      }).catch(async (cleanupError: unknown) => {
        await store.appendBootEvent(session.id, {
          phase: "cleanup",
          status: "failed",
          message: redactSecrets(cleanupError instanceof Error ? cleanupError.message : String(cleanupError))
        });
      });
    }
    await store.recordBootPhase(session.id, "failed", "failed", message);
  }
}

async function cleanupDataBranch(session: LiveForkSession) {
  const dataBranch = session.internal?.dataBranch;
  const environmentRef = session.data.environmentRef;
  if (!dataBranch || dataBranch.provider !== "neon" || !environmentRef || !session.organizationId) return;

  const resolved = await configStore.resolveEnvironment(session.organizationId, environmentRef);
  await neonProvider.deleteBranch({
    apiKey: resolved.neonApiKey,
    projectId: dataBranch.projectId,
    branchId: dataBranch.branchId
  });
  await store.appendBootEvent(session.id, {
    phase: "cleanup",
    status: "completed",
    message: `Neon branch ${dataBranch.branchId} deleted`
  });
}

async function cleanupExpiredSessions() {
  for (const session of store.expiredSessions()) {
    let cleanupError: unknown;
    try {
      await store.recordBootPhase(session.id, "cleanup", "running", "Cleaning up expired live fork session");
      await provider.stop(session);
    } catch (error) {
      cleanupError = error;
    }

    try {
      await cleanupDataBranch(session);
    } catch (error) {
      cleanupError = cleanupError ?? error;
    }

    if (cleanupError) {
      await store.appendBootEvent(session.id, {
        phase: "cleanup",
        status: "failed",
        message: cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
      });
    }

    await store.update(session.id, {
      sandbox: { status: "stopped" },
      lifecycle: { stoppedAt: new Date().toISOString() }
    });
    await store.appendBootEvent(session.id, {
      phase: "ready",
      status: "completed",
      message: "Session expired and was cleaned up"
    });
  }
}

setInterval(() => {
  cleanupExpiredSessions().catch((error: unknown) => {
    console.error("TTL cleanup failed", error);
  });
}, 5 * 60 * 1000).unref();

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "workpowers-control-plane" });
});

app.post("/app-environments/neon", async (req, res, next) => {
  try {
    const input = neonEnvironmentSetupSchema.parse(req.body);
    await assertOrganizationMembership(input.userId, input.organizationId);
    const result = await configStore.upsertNeonEnvironment(input);
    res.status(201).json({
      app: {
        id: result.app.id,
        name: result.app.name,
        repoFullName: result.app.repoFullName,
        defaultBranch: result.app.defaultBranch,
        profilePath: result.app.profilePath
      },
      environment: {
        id: result.environment.id,
        name: result.environment.name,
        dataProvider: result.environment.dataProvider,
        dataConfig: result.environment.dataConfig
      },
      credential: {
        id: result.credential.id,
        provider: result.credential.provider,
        label: result.credential.label,
        sourceType: result.credential.sourceType,
        revokedAt: result.credential.revokedAt
      }
    });
  } catch (error) {
    next(error);
  }
});

app.post("/sessions", async (req, res, next) => {
  try {
    const input = createSessionSchema.parse(req.body);
    const profile = input.profilePath ? await loadLiveForkProfile(input.profilePath) : undefined;
    const repoUrl = profile ? profileRepoUrl(profile) : input.repoUrl;
    if (!repoUrl) throw new Error("repoUrl or profilePath is required.");
    const sessionId = `sess_${nanoid(10)}`;
    const normalizedInput: NormalizedCreateSessionRequest = {
      ...input,
      repoUrl,
      credentialRef: profile?.repo.credentialRef ?? input.credentialRef,
      profile
    };
    const session = createStartingSession(normalizedInput, sessionId, provider);
    await store.set(session);

    void provisionInBackground(session, normalizedInput);

    res.status(202).json(sessionSummary(session));
  } catch (error) {
    next(error);
  }
});

async function resolveOrgGitHubRepoAccess(input: NormalizedCreateSessionRequest) {
  if (!input.organizationId || !input.userId) {
    throw new Error("organizationId and userId are required when credentialRef is org:github-app.");
  }

  await assertOrganizationMembership(input.userId, input.organizationId);
  return resolveGitHubRepoAccess({
    organizationId: input.organizationId,
    repo: input.repoUrl
  });
}

app.get("/sessions", (_req, res) => {
  res.json({ sessions: store.listPublic() });
});

app.get("/sessions/:id", async (req, res) => {
  const session = await requireSession(req.params.id);
  if (!session) return res.status(404).json({ error: "session_not_found" });
  return res.json(redactSession(session));
});

app.get("/sessions/:id/events", async (req, res) => {
  const session = await requireSession(req.params.id);
  if (!session) return res.status(404).json({ error: "session_not_found" });
  return res.json({ events: session.boot.events });
});

app.post("/sessions/:id/command", async (req, res, next) => {
  try {
    const session = await requireSession(req.params.id);
    if (!session) return res.status(404).json({ error: "session_not_found" });
    if (session.sandbox.status !== "running") return res.status(409).json({ error: "session_not_ready" });

    const command = commandSchema.parse(req.body);
    const result = redactCommandResult(await provider.runCommand(session, command));
    await store.update(session.id, {
      artifacts: {
        logs: [...(session.artifacts.logs ?? []), `$ ${redactSecrets(command.command)}`, result.stdout, result.stderr].filter(Boolean)
      }
    });
    return res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/sessions/:id/playwright", async (req, res, next) => {
  try {
    const session = await requireSession(req.params.id);
    if (!session) return res.status(404).json({ error: "session_not_found" });
    if (session.sandbox.status !== "running") return res.status(409).json({ error: "session_not_ready" });

    const result = redactCommandResult(await provider.runPlaywright(session));
    await recordLifecycleEvent(session.id, `Playwright finished with exit code ${result.exitCode}`);
    return res.json(result);
  } catch (error) {
    next(error);
  }
});

app.get("/sessions/:id/logs", async (req, res, next) => {
  try {
    const session = await requireSession(req.params.id);
    if (!session) return res.status(404).json({ error: "session_not_found" });
    if (session.sandbox.status !== "running") return res.json({ logs: session.artifacts.logs ?? [] });

    const logs = await provider.getLogs(session);
    await store.update(session.id, { artifacts: { logs } });
    return res.json({ logs });
  } catch (error) {
    next(error);
  }
});

app.get("/sessions/:id/diff", async (req, res, next) => {
  try {
    const session = await requireSession(req.params.id);
    if (!session) return res.status(404).json({ error: "session_not_found" });
    if (session.sandbox.status !== "running") return res.status(409).json({ error: "session_not_ready" });

    const gitDiff = redactSecrets(await provider.getDiff(session));
    await store.update(session.id, { artifacts: { gitDiff } });
    return res.type("text/plain").send(gitDiff);
  } catch (error) {
    next(error);
  }
});

app.get("/sessions/:id/files", async (req, res, next) => {
  try {
    const session = await requireSession(req.params.id);
    if (!session) return res.status(404).json({ error: "session_not_found" });
    if (session.sandbox.status !== "running") return res.status(409).json({ error: "session_not_ready" });

    const filePath = filePathSchema.parse(req.query.path);
    const file = await provider.readFile(session, filePath);
    return res.json(file);
  } catch (error) {
    next(error);
  }
});

app.put("/sessions/:id/files", async (req, res, next) => {
  try {
    const session = await requireSession(req.params.id);
    if (!session) return res.status(404).json({ error: "session_not_found" });
    if (session.sandbox.status !== "running") return res.status(409).json({ error: "session_not_ready" });

    const input = fileWriteSchema.parse(req.body);
    const file = await provider.writeFile(session, input);
    await recordLifecycleEvent(session.id, `Wrote ${input.path}`);
    return res.json(file);
  } catch (error) {
    next(error);
  }
});

app.post("/sessions/:id/agent-runs", async (req, res, next) => {
  try {
    const session = await requireSession(req.params.id);
    if (!session) return res.status(404).json({ error: "session_not_found" });
    if (session.sandbox.status !== "running") return res.status(409).json({ error: "session_not_ready" });

    const input = createAgentRunSchema.parse(req.body);
    const runId = `arun_${nanoid(10)}`;
    const now = new Date().toISOString();
    const startingRun: AgentRun = {
      id: runId,
      sessionId: session.id,
      harness: input.harness,
      terminalId: "",
      status: "starting",
      prompt: input.prompt,
      createdAt: now
    };
    const adapter = resolveAgentHarness(input.harness);
    const env = adapter.envForRun(startingRun);
    const terminal = await provider.createTerminal(session, {
      command: adapter.command,
      args: adapter.argsForPrompt(input.prompt, startingRun),
      cwd: ".",
      env,
      cols: 110,
      rows: 30,
      kind: "agent"
    });

    const run: AgentRun = {
      ...startingRun,
      terminalId: terminal.id,
      status: "running",
      startedAt: now
    };

    await store.appendAgentRun(session.id, run);
    await recordLifecycleEvent(session.id, `Started ${adapter.label} agent run ${run.id}`);
    watchAgentRunExit(session.id, run.id, terminal.id);
    return res.status(201).json({ ...run, prompt: redactSecrets(run.prompt) });
  } catch (error) {
    next(error);
  }
});

app.get("/sessions/:id/agent-runs", async (req, res) => {
  const session = await requireSession(req.params.id);
  if (!session) return res.status(404).json({ error: "session_not_found" });
  return res.json({ agentRuns: publicAgentRuns(session) });
});

app.get("/sessions/:id/agent-runs/:runId", async (req, res) => {
  const session = await requireSession(req.params.id);
  if (!session) return res.status(404).json({ error: "session_not_found" });
  const run = findAgentRun(session, req.params.runId);
  if (!run) return res.status(404).json({ error: "agent_run_not_found" });
  return res.json(run);
});

app.post("/sessions/:id/agent-runs/:runId/stdin", async (req, res, next) => {
  try {
    const session = await requireSession(req.params.id);
    if (!session) return res.status(404).json({ error: "session_not_found" });
    if (session.sandbox.status !== "running") return res.status(409).json({ error: "session_not_ready" });
    const run = findAgentRun(session, req.params.runId);
    if (!run) return res.status(404).json({ error: "agent_run_not_found" });

    const input = terminalStdinSchema.parse(req.body);
    await provider.writeTerminal(session, run.terminalId, input.data);
    return res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/sessions/:id/agent-runs/:runId/resize", async (req, res, next) => {
  try {
    const session = await requireSession(req.params.id);
    if (!session) return res.status(404).json({ error: "session_not_found" });
    if (session.sandbox.status !== "running") return res.status(409).json({ error: "session_not_ready" });
    const run = findAgentRun(session, req.params.runId);
    if (!run) return res.status(404).json({ error: "agent_run_not_found" });

    const input = terminalResizeSchema.parse(req.body);
    await provider.resizeTerminal(session, run.terminalId, input.cols, input.rows);
    return res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/sessions/:id/agent-runs/:runId/stop", async (req, res, next) => {
  try {
    const session = await requireSession(req.params.id);
    if (!session) return res.status(404).json({ error: "session_not_found" });
    if (session.sandbox.status !== "running") return res.status(409).json({ error: "session_not_ready" });
    const run = findAgentRun(session, req.params.runId);
    if (!run) return res.status(404).json({ error: "agent_run_not_found" });

    await store.updateAgentRun(session.id, run.id, { status: "stopping" });
    await provider.killTerminal(session, run.terminalId);
    const stopped = await store.updateAgentRun(session.id, run.id, {
      status: "stopped",
      completedAt: new Date().toISOString()
    });
    return res.json(findAgentRun(stopped ?? session, run.id));
  } catch (error) {
    next(error);
  }
});

app.get("/sessions/:id/agent-runs/:runId/events", async (req, res, next) => {
  try {
    const session = await requireSession(req.params.id);
    if (!session) return res.status(404).json({ error: "session_not_found" });
    const run = findAgentRun(session, req.params.runId);
    if (!run) return res.status(404).json({ error: "agent_run_not_found" });

    const stream = await provider.openTerminalEventStream(session, run.terminalId, Number(req.query.after ?? 0));
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });

    await consumeTerminalEventStream(stream, async (event) => {
      await updateAgentRunFromTerminalEvent(session.id, run.id, event);
    }, res);
    res.end();
  } catch (error) {
    if (!res.headersSent) return next(error);
    res.end();
  }
});

app.post("/sessions/:id/stop", async (req, res, next) => {
  try {
    const session = await requireSession(req.params.id, false);
    if (!session) return res.status(404).json({ error: "session_not_found" });
    if (session.sandbox.status === "stopped") return res.json(redactSession(session));

    await store.recordBootPhase(session.id, "cleanup", "running", "Stopping runtime and cleaning up data branch");
    let cleanupError: unknown;
    try {
      await stopActiveAgentRuns(session);
      await provider.stop(session);
    } catch (error) {
      cleanupError = error;
    }
    try {
      await cleanupDataBranch(session);
    } catch (error) {
      cleanupError = cleanupError ?? error;
    }
    if (cleanupError) throw cleanupError;
    const stopped = await store.update(session.id, {
      sandbox: { status: "stopped" },
      lifecycle: { stoppedAt: new Date().toISOString() }
    });
    await store.appendBootEvent(session.id, {
      phase: "ready",
      status: "completed",
      message: "Session stopped"
    });
    return res.json(stopped ? redactSession(stopped) : undefined);
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = redactSecrets(error instanceof Error ? error.message : String(error));
  res.status(400).json({ error: "request_failed", message });
});

app.listen(port, () => {
  console.log(`WorkPowers control plane listening on http://localhost:${port}`);
});
