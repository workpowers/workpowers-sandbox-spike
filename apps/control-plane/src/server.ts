import "dotenv/config";
import cors from "cors";
import express from "express";
import { nanoid } from "nanoid";
import { GITHUB_APP_CREDENTIAL_REF, assertOrganizationMembership, resolveGitHubRepoAccess } from "../../spike-app/server/github-app.js";
import { redactCommandResult, redactSecrets } from "../../../packages/live-fork/src/redaction.js";
import { commandSchema, createSessionSchema, filePathSchema, fileWriteSchema } from "../../../packages/live-fork/src/schemas.js";
import { LiveForkSessionStore, redactSession } from "../../../packages/live-fork/src/session-store.js";
import type { LiveForkSession } from "../../../packages/live-fork/src/types.js";
import { createProvider } from "./providers/index.js";
import { createStartingSession, type NormalizedCreateSessionRequest } from "./providers/provider.js";

const app = express();
const port = Number(process.env.CONTROL_PLANE_PORT ?? 8787);
const store = new LiveForkSessionStore();
const provider = createProvider();

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

async function provisionInBackground(session: LiveForkSession, input: NormalizedCreateSessionRequest) {
  try {
    const provisioned = await provider.create(input, session, async (phase, status, message) => {
      await store.recordBootPhase(session.id, phase, status, message);
    });

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
    await store.recordBootPhase(session.id, "failed", "failed", message);
  }
}

async function cleanupExpiredSessions() {
  for (const session of store.expiredSessions()) {
    try {
      await provider.stop(session);
    } catch (error) {
      await store.appendBootEvent(session.id, {
        phase: "failed",
        status: "failed",
        message: error instanceof Error ? error.message : String(error)
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

app.post("/sessions", async (req, res, next) => {
  try {
    const input = createSessionSchema.parse(req.body);
    const repoAccess =
      input.credentialRef === GITHUB_APP_CREDENTIAL_REF
        ? await resolveOrgGitHubRepoAccess(input)
        : undefined;
    const sessionId = `sess_${nanoid(10)}`;
    const normalizedInput = { ...input, repoAccess };
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

app.post("/sessions/:id/stop", async (req, res, next) => {
  try {
    const session = await requireSession(req.params.id, false);
    if (!session) return res.status(404).json({ error: "session_not_found" });
    if (session.sandbox.status === "stopped") return res.json(redactSession(session));

    await provider.stop(session);
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
