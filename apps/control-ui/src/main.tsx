import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  Braces,
  ExternalLink,
  FileCode2,
  GitCompareArrows,
  LoaderCircle,
  Play,
  Power,
  RefreshCcw,
  SquareTerminal
} from "lucide-react";
import type { CommandResult, LiveForkBootEvent, LiveForkSession } from "../../../packages/live-fork/src/types.js";
import "./styles.css";

type SessionSummary = {
  sessionId: string;
  status: LiveForkSession["sandbox"]["status"];
  bootPhase: LiveForkSession["boot"]["phase"];
  previewUrl?: string;
  expiresAt: string;
};

type FileResponse = {
  path: string;
  content: string;
};

const defaultRepo = "local";
const defaultPath = "apps/spike-app/src/main.tsx";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/control${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || response.statusText);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) return (await response.json()) as T;
  return (await response.text()) as T;
}

function App() {
  const [sessions, setSessions] = useState<LiveForkSession[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [repoUrl, setRepoUrl] = useState(defaultRepo);
  const [ref, setRef] = useState("main");
  const [filePath, setFilePath] = useState(defaultPath);
  const [fileContent, setFileContent] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const [diff, setDiff] = useState("");
  const [playwright, setPlaywright] = useState<CommandResult | null>(null);
  const [commandResult, setCommandResult] = useState<CommandResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const selected = useMemo(
    () => sessions.find((session) => session.id === selectedId) ?? sessions[0],
    [selectedId, sessions]
  );

  async function loadSessions() {
    const response = await api<{ sessions: LiveForkSession[] }>("/sessions");
    setSessions(response.sessions);
    setSelectedId((current) => {
      if (current && response.sessions.some((session) => session.id === current)) return current;
      return response.sessions[0]?.id ?? "";
    });
  }

  useEffect(() => {
    loadSessions().catch((loadError: Error) => setError(loadError.message));
    const interval = window.setInterval(() => {
      loadSessions().catch(() => undefined);
    }, 2500);
    return () => window.clearInterval(interval);
  }, []);

  async function runAction<T>(label: string, action: () => Promise<T>) {
    setBusy(label);
    setError("");
    try {
      return await action();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
      return undefined;
    } finally {
      setBusy("");
    }
  }

  async function startSession(event: FormEvent) {
    event.preventDefault();
    const created = await runAction("start", () =>
      api<SessionSummary>("/sessions", {
        method: "POST",
        body: JSON.stringify({
          repoUrl,
          ref,
          template: "node-pnpm-playwright-postgres",
          data: { mode: "local_seed", seedName: "basic-projects" }
        })
      })
    );
    if (created) {
      setSelectedId(created.sessionId);
      await loadSessions();
    }
  }

  async function readFile() {
    if (!selected) return;
    const file = await runAction("read-file", () =>
      api<FileResponse>(`/sessions/${selected.id}/files?path=${encodeURIComponent(filePath)}`)
    );
    if (file) setFileContent(file.content);
  }

  async function writeFile() {
    if (!selected) return;
    const file = await runAction("write-file", () =>
      api<FileResponse>(`/sessions/${selected.id}/files`, {
        method: "PUT",
        body: JSON.stringify({ path: filePath, content: fileContent })
      })
    );
    if (file) setFileContent(file.content);
  }

  async function runPlaywright() {
    if (!selected) return;
    const result = await runAction("playwright", () =>
      api<CommandResult>(`/sessions/${selected.id}/playwright`, { method: "POST" })
    );
    if (result) setPlaywright(result);
  }

  async function runHealthCommand() {
    if (!selected) return;
    const result = await runAction("command", () =>
      api<CommandResult>(`/sessions/${selected.id}/command`, {
        method: "POST",
        body: JSON.stringify({ command: "curl -fsS http://localhost:3001/health", timeoutSeconds: 30 })
      })
    );
    if (result) setCommandResult(result);
  }

  async function loadLogs() {
    if (!selected) return;
    const response = await runAction("logs", () => api<{ logs: string[] }>(`/sessions/${selected.id}/logs`));
    if (response) setLogs(response.logs);
  }

  async function loadDiff() {
    if (!selected) return;
    const response = await runAction("diff", () => api<string>(`/sessions/${selected.id}/diff`));
    if (response !== undefined) setDiff(response);
  }

  async function stopSession() {
    if (!selected) return;
    await runAction("stop", () => api<LiveForkSession>(`/sessions/${selected.id}/stop`, { method: "POST" }));
    await loadSessions();
  }

  return (
    <main className="operator-shell">
      <aside className="control-rail">
        <div className="brand-lockup">
          <GitCompareArrows size={24} />
          <div>
            <strong>WorkPowers</strong>
            <span>Live Fork Control</span>
          </div>
        </div>

        <form className="session-form" onSubmit={startSession}>
          <label>
            Repository
            <input value={repoUrl} onChange={(event) => setRepoUrl(event.target.value)} />
          </label>
          <label>
            Ref
            <input value={ref} onChange={(event) => setRef(event.target.value)} />
          </label>
          <button type="submit" disabled={Boolean(busy)}>
            {busy === "start" ? <LoaderCircle size={17} className="spin" /> : <Play size={17} />}
            Start Session
          </button>
        </form>

        <nav className="session-list" aria-label="Live fork sessions">
          {sessions.map((session) => (
            <button
              key={session.id}
              className={session.id === selected?.id ? "selected" : ""}
              onClick={() => setSelectedId(session.id)}
            >
              <span>{session.id}</span>
              <small>{session.boot.phase}</small>
            </button>
          ))}
        </nav>
      </aside>

      <section className="workbench">
        <header className="session-header">
          <div>
            <span className="eyebrow">{selected?.repoUrl ?? "No session"}</span>
            <h1>{selected ? selected.id : "Start a Live Fork"}</h1>
          </div>
          <div className={`status-badge ${selected?.sandbox.status ?? "empty"}`}>
            <Activity size={15} />
            {selected?.sandbox.status ?? "idle"}
          </div>
        </header>

        {error ? <div className="error-line">{error}</div> : null}

        <section className="phase-strip">
          {(selected?.boot.events ?? []).map((event, index) => (
            <Phase event={event} key={`${event.phase}-${event.timestamp}-${index}`} />
          ))}
        </section>

        <section className="preview-band">
          <div className="preview-toolbar">
            <div>
              <span>Preview</span>
              <strong>{selected?.app.previewUrl || "Waiting for ready state"}</strong>
            </div>
            {selected?.app.previewUrl ? (
              <a href={selected.app.previewUrl} target="_blank" rel="noreferrer" aria-label="Open preview">
                <ExternalLink size={18} />
              </a>
            ) : null}
          </div>
          {selected?.app.previewUrl ? <iframe title="Live fork preview" src={selected.app.previewUrl} /> : null}
        </section>

        <section className="tool-grid">
          <section className="tool-panel file-panel">
            <PanelTitle icon={<FileCode2 size={18} />} title="File Editor" />
            <div className="file-row">
              <input value={filePath} onChange={(event) => setFilePath(event.target.value)} />
              <button onClick={readFile} disabled={!selected || Boolean(busy)}>
                <RefreshCcw size={17} />
              </button>
              <button onClick={writeFile} disabled={!selected || Boolean(busy)}>
                Save
              </button>
            </div>
            <textarea value={fileContent} onChange={(event) => setFileContent(event.target.value)} spellCheck={false} />
          </section>

          <section className="tool-panel">
            <PanelTitle icon={<SquareTerminal size={18} />} title="Actions" />
            <div className="action-stack">
              <button onClick={runPlaywright} disabled={!selected || Boolean(busy)}>
                <Play size={17} />
                Run Playwright
              </button>
              <button onClick={runHealthCommand} disabled={!selected || Boolean(busy)}>
                <Braces size={17} />
                Health Command
              </button>
              <button onClick={loadLogs} disabled={!selected || Boolean(busy)}>
                <RefreshCcw size={17} />
                Show Logs
              </button>
              <button onClick={loadDiff} disabled={!selected || Boolean(busy)}>
                <GitCompareArrows size={17} />
                Show Diff
              </button>
              <button className="danger" onClick={stopSession} disabled={!selected || Boolean(busy)}>
                <Power size={17} />
                Stop Session
              </button>
            </div>
            <Result label="Playwright" result={playwright} />
            <Result label="Command" result={commandResult} />
          </section>

          <section className="tool-panel output-panel">
            <PanelTitle icon={<SquareTerminal size={18} />} title="Logs" />
            <pre>{logs.join("\n") || "No logs loaded."}</pre>
          </section>

          <section className="tool-panel output-panel">
            <PanelTitle icon={<GitCompareArrows size={18} />} title="Diff" />
            <pre>{diff || "No diff loaded."}</pre>
          </section>
        </section>
      </section>
    </main>
  );
}

function PanelTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="panel-title">
      {icon}
      <h2>{title}</h2>
    </div>
  );
}

function Phase({ event }: { event: LiveForkBootEvent }) {
  return (
    <article className={`phase ${event.status}`}>
      <strong>{event.phase.replaceAll("_", " ")}</strong>
      <span>{event.message}</span>
    </article>
  );
}

function Result({ label, result }: { label: string; result: CommandResult | null }) {
  if (!result) return null;

  return (
    <div className="result-block">
      <span>{label} exit {result.exitCode}</span>
      <pre>{[result.stdout, result.stderr].filter(Boolean).join("\n") || "No output."}</pre>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
