import "dotenv/config";
import { exec, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import express from "express";
import { nanoid } from "nanoid";
import * as pty from "node-pty";
import { redactSecrets } from "../../../packages/live-fork/src/redaction.js";
import type { CreateTerminalRequest, TerminalEvent, TerminalKind, TerminalSummary } from "../../../packages/live-fork/src/types.js";

const execAsync = promisify(exec);
const app = express();
const port = Number(process.env.SESSION_DAEMON_PORT ?? 8790);
const workdir = path.resolve(process.env.LIVE_FORK_WORKDIR ?? process.cwd());
const processTable = new Map<string, ChildProcessWithoutNullStreams>();
const terminalTable = new Map<string, TerminalRecord>();
const logBuffer: string[] = [];
const maxTerminalEvents = Number(process.env.WORKPOWERS_TERMINAL_EVENT_LIMIT ?? 1_000);

type TerminalRecord = {
  id: string;
  kind: TerminalKind;
  cwd: string;
  command: string;
  terminal: pty.IPty;
  events: TerminalEvent[];
  clients: Set<express.Response>;
  seq: number;
  status: "running" | "exited";
  createdAt: string;
  exitCode?: number | null;
  killTimer?: NodeJS.Timeout;
};

type NewTerminalEvent =
  | { type: "output"; data: string }
  | { type: "exit"; exitCode: number | null; signal?: string }
  | { type: "error"; message: string };

app.use(express.json({ limit: "2mb" }));

function pushLog(line: string) {
  logBuffer.push(redactSecrets(line));
  if (logBuffer.length > 500) logBuffer.shift();
}

function safePath(relativePath = ".") {
  const target = path.resolve(workdir, relativePath);
  const relative = path.relative(workdir, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Path escapes the live fork workdir");
  }
  return target;
}

function terminalSummary(record: TerminalRecord): TerminalSummary {
  return {
    id: record.id,
    kind: record.kind,
    status: record.status,
    cwd: path.relative(workdir, record.cwd) || ".",
    command: redactSecrets(record.command),
    pid: record.terminal.pid,
    exitCode: record.exitCode,
    createdAt: record.createdAt
  };
}

function pushTerminalEvent(record: TerminalRecord, event: NewTerminalEvent) {
  const next: TerminalEvent = {
    ...event,
    seq: ++record.seq,
    timestamp: new Date().toISOString()
  } as TerminalEvent;

  const redacted = redactTerminalEvent(next);
  record.events.push(redacted);
  if (record.events.length > maxTerminalEvents) record.events.shift();

  const payload = `id: ${redacted.seq}\nevent: terminal\ndata: ${JSON.stringify(redacted)}\n\n`;
  for (const client of record.clients) client.write(payload);
  if (redacted.type === "exit") {
    for (const client of record.clients) client.end();
    record.clients.clear();
  }

  if (redacted.type === "output") pushLog(`[${record.id}] ${redacted.data}`);
  if (redacted.type === "exit") pushLog(`[${record.id}] exited ${redacted.exitCode}`);
  if (redacted.type === "error") pushLog(`[${record.id}] error ${redacted.message}`);
}

function redactTerminalEvent(event: TerminalEvent): TerminalEvent {
  if (event.type === "output") return { ...event, data: redactSecrets(event.data) };
  if (event.type === "error") return { ...event, message: redactSecrets(event.message) };
  return event;
}

function requireTerminal(id: string) {
  const record = terminalTable.get(id);
  if (!record) throw new Error("terminal_not_found");
  return record;
}

async function run(command: string, cwd = workdir, timeoutSeconds = 60) {
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      shell: process.env.SHELL ?? "/bin/sh",
      timeout: timeoutSeconds * 1000,
      maxBuffer: 10 * 1024 * 1024
    });
    pushLog(`$ ${command}`);
    if (stdout) pushLog(stdout);
    if (stderr) pushLog(stderr);
    return { exitCode: 0, stdout: redactSecrets(stdout), stderr: redactSecrets(stderr) };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string; message?: string };
    return {
      exitCode: failure.code ?? 1,
      stdout: redactSecrets(failure.stdout ?? ""),
      stderr: redactSecrets(failure.stderr ?? failure.message ?? "")
    };
  }
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "workpowers-session-daemon", workdir });
});

app.post("/run-command", async (req, res, next) => {
  try {
    const result = await run(String(req.body.command), req.body.cwd ? safePath(String(req.body.cwd)) : workdir, Number(req.body.timeoutSeconds ?? 60));
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.get("/logs", (_req, res) => {
  res.json({ logs: logBuffer });
});

app.get("/git-diff", async (_req, res) => {
  const result = await run("git diff -- . && git ls-files --others --exclude-standard | sed 's/^/?? /'", workdir, 30);
  res.type("text/plain").send(result.stdout || result.stderr);
});

app.post("/write-file", async (req, res, next) => {
  try {
    const target = safePath(String(req.body.path));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, String(req.body.content));
    pushLog(`write-file ${path.relative(workdir, target)}`);
    res.json({ ok: true, path: path.relative(workdir, target) });
  } catch (error) {
    next(error);
  }
});

app.get("/read-file", async (req, res, next) => {
  try {
    const target = safePath(String(req.query.path));
    res.type("text/plain").send(await fs.readFile(target, "utf8"));
  } catch (error) {
    next(error);
  }
});

app.post("/start-process", (req, res, next) => {
  try {
    const id = `proc_${nanoid(8)}`;
    const child = spawn(String(req.body.command), {
      cwd: req.body.cwd ? safePath(String(req.body.cwd)) : workdir,
      shell: true,
      env: { ...process.env, ...(req.body.env ?? {}) }
    });

    child.stdout.on("data", (chunk) => pushLog(`[${id}] ${chunk.toString()}`));
    child.stderr.on("data", (chunk) => pushLog(`[${id}] ${chunk.toString()}`));
    child.on("exit", (code) => {
      pushLog(`[${id}] exited ${code}`);
      processTable.delete(id);
    });
    processTable.set(id, child);
    res.status(201).json({ id, pid: child.pid });
  } catch (error) {
    next(error);
  }
});

app.post("/stop-process", (req, res) => {
  const processId = String(req.body.id);
  const child = processTable.get(processId);
  if (!child) return res.status(404).json({ error: "process_not_found" });
  child.kill("SIGTERM");
  processTable.delete(processId);
  return res.json({ ok: true });
});

app.post("/run-playwright", async (_req, res) => {
  res.json(await run("pnpm playwright:smoke", workdir, 120));
});

app.post("/terminals", (req, res, next) => {
  try {
    const input = req.body as CreateTerminalRequest;
    const id = `term_${nanoid(10)}`;
    const cols = Number(input.cols ?? 100);
    const rows = Number(input.rows ?? 28);
    const cwd = safePath(input.cwd ?? ".");
    const command = input.command?.trim() || process.env.SHELL || "/bin/sh";
    const args = input.args ?? [];
    const kind = input.kind ?? "shell";
    const runAsUid = kind === "agent" && process.getuid?.() === 0
      ? Number(process.env.WORKPOWERS_AGENT_UID ?? 1000)
      : undefined;
    const runAsGid = kind === "agent" && process.getuid?.() === 0
      ? Number(process.env.WORKPOWERS_AGENT_GID ?? 1000)
      : undefined;
    const terminal = pty.spawn(command, args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd,
      uid: runAsUid,
      gid: runAsGid,
      env: {
        ...process.env,
        ...(input.env ?? {}),
        LIVE_FORK_WORKDIR: workdir,
        WORKPOWERS_TERMINAL_ID: id
      }
    });

    const record: TerminalRecord = {
      id,
      kind,
      cwd,
      command: [command, ...args].join(" "),
      terminal,
      events: [],
      clients: new Set(),
      seq: 0,
      status: "running",
      createdAt: new Date().toISOString()
    };

    terminal.onData((data) => pushTerminalEvent(record, { type: "output", data }));
    terminal.onExit(({ exitCode, signal }) => {
      record.status = "exited";
      record.exitCode = exitCode;
      if (record.killTimer) clearTimeout(record.killTimer);
      pushTerminalEvent(record, { type: "exit", exitCode, signal: signal ? String(signal) : undefined });
    });

    terminalTable.set(id, record);
    pushLog(`[${id}] started ${record.command}`);
    res.status(201).json(terminalSummary(record));
  } catch (error) {
    next(error);
  }
});

app.get("/terminals/:id", (req, res, next) => {
  try {
    res.json(terminalSummary(requireTerminal(req.params.id)));
  } catch (error) {
    next(error);
  }
});

app.get("/terminals/:id/events", (req, res, next) => {
  try {
    const record = requireTerminal(req.params.id);
    const after = Number(req.query.after ?? 0);

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });

    for (const event of record.events) {
      if (event.seq > after) {
        res.write(`id: ${event.seq}\nevent: terminal\ndata: ${JSON.stringify(event)}\n\n`);
      }
    }

    if (record.status === "exited") {
      res.end();
      return;
    }

    record.clients.add(res);
    const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15_000);
    req.on("close", () => {
      clearInterval(heartbeat);
      record.clients.delete(res);
    });
  } catch (error) {
    next(error);
  }
});

app.post("/terminals/:id/stdin", (req, res, next) => {
  try {
    const record = requireTerminal(req.params.id);
    if (record.status !== "running") return res.status(409).json({ error: "terminal_exited" });
    record.terminal.write(String(req.body.data ?? ""));
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/terminals/:id/resize", (req, res, next) => {
  try {
    const record = requireTerminal(req.params.id);
    if (record.status !== "running") return res.status(409).json({ error: "terminal_exited" });
    record.terminal.resize(Number(req.body.cols), Number(req.body.rows));
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/terminals/:id/kill", (req, res, next) => {
  try {
    const record = requireTerminal(req.params.id);
    if (record.status !== "running") return res.json({ ok: true });

    record.terminal.write("\x03");
    record.killTimer = setTimeout(() => {
      if (record.status === "running") record.terminal.kill("SIGTERM");
    }, 1_500);

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = redactSecrets(error instanceof Error ? error.message : String(error));
  const status = message === "terminal_not_found" ? 404 : 400;
  res.status(status).json({ error: "daemon_request_failed", message });
});

app.listen(port, () => {
  console.log(`WorkPowers session daemon listening on http://localhost:${port}`);
});
