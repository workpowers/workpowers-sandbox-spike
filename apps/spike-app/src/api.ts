export type Project = {
  id: string;
  name: string;
  createdAt: string;
};

export async function listProjects() {
  const response = await fetch("/api/projects", { credentials: "include" });
  if (!response.ok) throw new Error("Could not load projects");
  return (await response.json()) as { projects: Project[] };
}

export async function createProject(name: string) {
  const response = await fetch("/api/projects", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name })
  });
  if (!response.ok) throw new Error("Could not create project");
  return (await response.json()) as { project: Project };
}
