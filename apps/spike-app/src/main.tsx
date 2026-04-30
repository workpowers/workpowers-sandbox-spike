import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Bot, Boxes, CircleDot, ExternalLink, GitBranch, Github, LogOut, Plus, RefreshCw, ShieldCheck, TerminalSquare } from "lucide-react";
import { authClient } from "./auth-client.js";
import {
  createProject,
  getGitHubAppConfig,
  listGitHubAccess,
  listProjects,
  syncGitHubInstallation,
  type GitHubAppConfig,
  type GitHubInstallation,
  type GitHubRepositoryGrant,
  type Project
} from "./api.js";
import "./styles.css";

const credentials = {
  email: "agent@example.com",
  password: "password1234"
};

function navigate(path: string) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function useRoute() {
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const update = () => setPath(window.location.pathname);
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);

  if (path === "/") return "/dashboard";
  if (path === "/github/setup") return "/github";
  return path;
}

function Login() {
  const [email, setEmail] = useState(credentials.email);
  const [password, setPassword] = useState(credentials.password);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const result = await authClient.signIn.email({ email, password });
    if (result.error) {
      setError(result.error.message ?? "Sign in failed");
      return;
    }
    window.location.assign("/dashboard");
  }

  return (
    <main className="login-shell">
      <section className="login-panel">
        <div className="mark">
          <GitBranch size={30} />
        </div>
        <h1>Live Fork</h1>
        <p>Step into the seeded session.</p>
        <form onSubmit={submit} className="login-form">
          <label>
            Email
            <input value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
          </label>
          <label>
            Password
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              autoComplete="current-password"
            />
          </label>
          {error ? <span className="form-error">{error}</span> : null}
          <button type="submit">Enter session</button>
        </form>
      </section>
      <aside className="session-slab">
        <div>
          <span>localhost:3000</span>
          <strong>Human preview surface</strong>
        </div>
        <div>
          <span>Playwright</span>
          <strong>Internal browser lane</strong>
        </div>
        <div>
          <span>Postgres seed</span>
          <strong>Session-scoped state</strong>
        </div>
      </aside>
    </main>
  );
}

function Layout({ route }: { route: string }) {
  const session = authClient.useSession();
  const activeOrganization = authClient.useActiveOrganization();

  useEffect(() => {
    if (!session.isPending && !session.data && route !== "/login") navigate("/login");
  }, [route, session.data, session.isPending]);

  if (route === "/login") return <Login />;
  if (session.isPending) return <div className="loading">Claiming session...</div>;
  if (!session.data) return null;

  const activeOrgName = activeOrganization.data?.name ?? "Personal workspace";

  return (
    <main className="app-shell">
      <aside className="rail">
        <div className="rail-brand">
          <GitBranch size={24} />
          <span>WorkPowers</span>
        </div>
        <button className={route === "/dashboard" ? "active" : ""} onClick={() => navigate("/dashboard")}>
          <TerminalSquare size={18} />
          Dashboard
        </button>
        <button className={route === "/projects" ? "active" : ""} onClick={() => navigate("/projects")}>
          <Boxes size={18} />
          Projects
        </button>
        <button className={route === "/github" ? "active" : ""} onClick={() => navigate("/github")}>
          <Github size={18} />
          GitHub
        </button>
        <button className="rail-exit" onClick={() => authClient.signOut().then(() => window.location.assign("/login"))}>
          <LogOut size={18} />
          Sign out
        </button>
      </aside>
      <section className="workspace">
        <header className="topbar">
          <div>
            <span>{session.data.user.email}</span>
            <h2>{routeTitle(route)}</h2>
            <small>{activeOrgName}</small>
          </div>
          <div className="status-pill">
            <CircleDot size={14} />
            Running
          </div>
        </header>
        {route === "/projects" ? <Projects /> : route === "/github" ? <GitHubAccess /> : <Dashboard />}
      </section>
    </main>
  );
}

function routeTitle(route: string) {
  if (route === "/projects") return "Projects";
  if (route === "/github") return "GitHub Access";
  return "Session Dashboard";
}

function Dashboard() {
  return (
    <div className="dashboard-grid">
      <Metric icon={<ShieldCheck size={22} />} label="Auth" value="Better Auth" />
      <Metric icon={<Boxes size={22} />} label="Data" value="Postgres seed" />
      <Metric icon={<Bot size={22} />} label="Agent lane" value="Playwright local" />
      <section className="activity-panel">
        <h3>Session Loop</h3>
        <ol>
          <li>Sandbox claimed</li>
          <li>Seed data available</li>
          <li>Preview serving on port 3000</li>
          <li>Diff export ready</li>
        </ol>
      </section>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <article className="metric">
      <span>{icon}</span>
      <small>{label}</small>
      <strong>{value}</strong>
    </article>
  );
}

function Projects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  async function load() {
    const response = await listProjects();
    setProjects(response.projects);
  }

  useEffect(() => {
    load().catch((loadError: Error) => setError(loadError.message));
  }, []);

  const newest = useMemo(() => projects[0]?.name ?? "No projects yet", [projects]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    await createProject(name.trim());
    setName("");
    await load();
  }

  return (
    <div className="projects-view">
      <section className="project-composer">
        <div>
          <span>Newest</span>
          <h3>{newest}</h3>
        </div>
        <form onSubmit={submit}>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="New project name"
            aria-label="New project name"
          />
          <button type="submit" aria-label="Create project">
            <Plus size={18} />
          </button>
        </form>
      </section>
      {error ? <p className="form-error">{error}</p> : null}
      <section className="project-list">
        {projects.map((project) => (
          <article key={project.id} className="project-row">
            <div>
              <strong>{project.name}</strong>
              <span>{new Date(project.createdAt).toLocaleString()}</span>
            </div>
            <CircleDot size={16} />
          </article>
        ))}
      </section>
    </div>
  );
}

function GitHubAccess() {
  const [config, setConfig] = useState<GitHubAppConfig | null>(null);
  const [installations, setInstallations] = useState<GitHubInstallation[]>([]);
  const [repositories, setRepositories] = useState<GitHubRepositoryGrant[]>([]);
  const [manualInstallationId, setManualInstallationId] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  async function load() {
    const [appConfig, access] = await Promise.all([getGitHubAppConfig(), listGitHubAccess()]);
    setConfig(appConfig);
    setInstallations(access.installations);
    setRepositories(access.repositories);
  }

  async function sync(installationId: string) {
    setError("");
    setStatus("Syncing GitHub repositories...");
    const result = await syncGitHubInstallation(installationId);
    setStatus(`Synced ${result.repositories.length} repositories from ${result.installation.githubAccountLogin}.`);
    await load();
  }

  useEffect(() => {
    load().catch((loadError: Error) => setError(loadError.message));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const installationId = params.get("installation_id");
    if (!installationId) return;

    sync(installationId)
      .then(() => {
        window.history.replaceState({}, "", "/github");
      })
      .catch((syncError: Error) => setError(syncError.message));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!manualInstallationId.trim()) return;
    await sync(manualInstallationId.trim());
    setManualInstallationId("");
  }

  return (
    <div className="github-view">
      <section className="github-setup">
        <div>
          <span>Credential reference</span>
          <h3>org:github-app</h3>
        </div>
        <div className="github-actions">
          {config?.installUrl ? (
            <a className="button-link" href={config.installUrl}>
              <Github size={18} />
              Install GitHub App
              <ExternalLink size={16} />
            </a>
          ) : (
            <span className="setup-note">Set GITHUB_APP_SLUG or GITHUB_APP_INSTALL_URL.</span>
          )}
          <button type="button" onClick={() => load().catch((loadError: Error) => setError(loadError.message))}>
            <RefreshCw size={18} />
            Refresh
          </button>
        </div>
      </section>

      {!config?.configured ? (
        <p className="form-error">Set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY before syncing installations.</p>
      ) : null}
      {status ? <p className="status-line">{status}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}

      <section className="manual-sync">
        <form onSubmit={submit}>
          <input
            value={manualInstallationId}
            onChange={(event) => setManualInstallationId(event.target.value)}
            placeholder="Installation ID"
            aria-label="GitHub installation ID"
          />
          <button type="submit">Sync</button>
        </form>
      </section>

      <section className="github-summary">
        <Metric icon={<Github size={22} />} label="Installations" value={String(installations.length)} />
        <Metric icon={<GitBranch size={22} />} label="Granted repositories" value={String(repositories.length)} />
      </section>

      <section className="project-list">
        {repositories.map((repository) => (
          <article key={repository.id} className="project-row">
            <div>
              <strong>{repository.fullName}</strong>
              <span>{repository.private ? "Private" : "Public"} · {repository.defaultBranch}</span>
            </div>
            <a href={repository.htmlUrl} aria-label={`Open ${repository.fullName}`}>
              <ExternalLink size={16} />
            </a>
          </article>
        ))}
        {repositories.length === 0 ? (
          <article className="empty-state">
            <strong>No repositories synced yet</strong>
            <span>Install the GitHub App on selected repositories, then return here.</span>
          </article>
        ) : null}
      </section>
    </div>
  );
}

function App() {
  const route = useRoute();
  return <Layout route={route} />;
}

createRoot(document.getElementById("root")!).render(<App />);
