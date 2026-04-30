export type Project = {
  id: string;
  name: string;
  orgId: string | null;
  creatorId: string | null;
  createdAt: string;
};

export type GitHubAppConfig = {
  configured: boolean;
  installUrl: string | null;
  credentialRef: "org:github-app";
};

export type GitHubInstallation = {
  id: string;
  githubInstallationId: string;
  githubAccountLogin: string;
  githubAccountType: string;
  repositorySelection: string;
  updatedAt: string;
};

export type GitHubRepositoryGrant = {
  id: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string;
  updatedAt: string;
};

async function parseJsonError(response: Response, fallback: string) {
  const body = await response.text();
  if (!body) return fallback;

  try {
    const json = JSON.parse(body) as { message?: string; error?: string };
    return json.message ?? json.error ?? fallback;
  } catch {
    return body;
  }
}

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

export async function getGitHubAppConfig() {
  const response = await fetch("/api/github/app", { credentials: "include" });
  if (!response.ok) throw new Error(await parseJsonError(response, "Could not load GitHub App configuration"));
  return (await response.json()) as GitHubAppConfig;
}

export async function listGitHubAccess() {
  const response = await fetch("/api/github/installations", { credentials: "include" });
  if (!response.ok) throw new Error(await parseJsonError(response, "Could not load GitHub access"));
  return (await response.json()) as {
    installations: GitHubInstallation[];
    repositories: GitHubRepositoryGrant[];
  };
}

export async function syncGitHubInstallation(githubInstallationId: string) {
  const response = await fetch("/api/github/installations/sync", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ githubInstallationId })
  });
  if (!response.ok) throw new Error(await parseJsonError(response, "Could not sync GitHub installation"));
  return (await response.json()) as {
    installation: {
      githubInstallationId: string;
      githubAccountLogin: string;
      githubAccountType: string;
      repositorySelection: string;
    };
    repositories: Array<{
      githubRepositoryId: string;
      fullName: string;
      private: boolean;
      defaultBranch: string;
      htmlUrl: string;
    }>;
  };
}
