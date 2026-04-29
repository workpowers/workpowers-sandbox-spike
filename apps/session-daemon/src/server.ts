import "dotenv/config";
import { exec, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import express from "express";
import { nanoid } from "nanoid";

const execAsync = promisify(exec);
const app = express();
const port = Number(process.env.SESSION_DAEMON_PORT ?? 8790);
const workdir = path.resolve(process.env.LIVE_FORK_WORKDIR ?? process.cwd());
const processTable = new Map<string, ChildProcessWithoutNullStreams>();
const logBuffer: string[] = [];

app.use(express.json({ limit: "2mb" }));

function pushLog(line: string) {
  logBuffer.push(line);
  if (logBuffer.length > 500) logBuffer.shift();
}

function safePath(relativePath: string) {
  const target = path.resolve(workdir, relativePath);
  if (!target.startsWith(workdir)) {
    throw new Error("Path escapes the live fork workdir");
  }
  return target;
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
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string; message?: string };
    return {
      exitCode: failure.code ?? 1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? failure.message ?? ""
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

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : String(error);
  res.status(400).json({ error: "daemon_request_failed", message });
});

app.listen(port, () => {
  console.log(`WorkPowers session daemon listening on http://localhost:${port}`);
});
