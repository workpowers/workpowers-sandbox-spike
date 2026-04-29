import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Bot, Boxes, CircleDot, GitBranch, LogOut, Plus, ShieldCheck, TerminalSquare } from "lucide-react";
import { authClient } from "./auth-client.js";
import { createProject, listProjects, type Project } from "./api.js";
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

  return path === "/" ? "/dashboard" : path;
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

  useEffect(() => {
    if (!session.isPending && !session.data && route !== "/login") navigate("/login");
  }, [route, session.data, session.isPending]);

  if (route === "/login") return <Login />;
  if (session.isPending) return <div className="loading">Claiming session...</div>;
  if (!session.data) return null;

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
        <button className="rail-exit" onClick={() => authClient.signOut().then(() => window.location.assign("/login"))}>
          <LogOut size={18} />
          Sign out
        </button>
      </aside>
      <section className="workspace">
        <header className="topbar">
          <div>
            <span>{session.data.user.email}</span>
            <h2>{route === "/projects" ? "Projects" : "Session Dashboard"}</h2>
          </div>
          <div className="status-pill">
            <CircleDot size={14} />
            Running
          </div>
        </header>
        {route === "/projects" ? <Projects /> : <Dashboard />}
      </section>
    </main>
  );
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

function App() {
  const route = useRoute();
  return <Layout route={route} />;
}

createRoot(document.getElementById("root")!).render(<App />);
