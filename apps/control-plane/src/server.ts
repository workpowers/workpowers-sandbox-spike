import "dotenv/config";
import express from "express";
import { nanoid } from "nanoid";
import { commandSchema, createSessionSchema } from "../../../packages/live-fork/src/schemas.js";
import { LiveForkSessionStore } from "../../../packages/live-fork/src/session-store.js";
import { createProvider } from "./providers/index.js";

const app = express();
const port = Number(process.env.CONTROL_PLANE_PORT ?? 8787);
const store = new LiveForkSessionStore();
const provider = createProvider();

app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "workpowers-control-plane" });
});

app.post("/sessions", async (req, res, next) => {
  try {
    const input = createSessionSchema.parse(req.body);
    const sessionId = `sess_${nanoid(10)}`;
    const { session } = await provider.create(input, sessionId);
    store.set(session);

    res.status(201).json({
      sessionId: session.id,
      status: session.sandbox.status,
      previewUrl: session.app.previewUrl,
      internalUrl: session.app.internalUrl,
      expiresAt: session.lifecycle.expiresAt
    });
  } catch (error) {
    next(error);
  }
});

app.get("/sessions", (_req, res) => {
  res.json({ sessions: store.list() });
});

app.get("/sessions/:id", (req, res) => {
  const session = store.get(req.params.id);
  if (!session) return res.status(404).json({ error: "session_not_found" });
  return res.json(session);
});

app.post("/sessions/:id/command", async (req, res, next) => {
  try {
    const session = store.get(req.params.id);
    if (!session) return res.status(404).json({ error: "session_not_found" });

    const command = commandSchema.parse(req.body);
    const result = await provider.runCommand(session, command);
    store.update(session.id, {
      artifacts: {
        logs: [...(session.artifacts.logs ?? []), `$ ${command.command}`, result.stdout, result.stderr].filter(Boolean)
      }
    });
    return res.json(result);
  } catch (error) {
    next(error);
  }
});

app.get("/sessions/:id/logs", async (req, res, next) => {
  try {
    const session = store.get(req.params.id);
    if (!session) return res.status(404).json({ error: "session_not_found" });
    const logs = await provider.getLogs(session);
    store.update(session.id, { artifacts: { logs } });
    return res.json({ logs });
  } catch (error) {
    next(error);
  }
});

app.get("/sessions/:id/diff", async (req, res, next) => {
  try {
    const session = store.get(req.params.id);
    if (!session) return res.status(404).json({ error: "session_not_found" });
    const gitDiff = await provider.getDiff(session);
    store.update(session.id, { artifacts: { gitDiff } });
    return res.type("text/plain").send(gitDiff);
  } catch (error) {
    next(error);
  }
});

app.post("/sessions/:id/stop", async (req, res, next) => {
  try {
    const session = store.get(req.params.id);
    if (!session) return res.status(404).json({ error: "session_not_found" });
    await provider.stop(session);
    const stopped = store.update(session.id, { sandbox: { ...session.sandbox, status: "stopped" } });
    return res.json(stopped);
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : String(error);
  res.status(400).json({ error: "request_failed", message });
});

app.listen(port, () => {
  console.log(`WorkPowers control plane listening on http://localhost:${port}`);
});
