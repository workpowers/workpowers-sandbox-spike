import crypto from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { redactSecrets } from "../../../packages/live-fork/src/redaction.js";
import { db } from "./db/client.js";
import {
  githubAppInstallations,
  githubRepositoryGrants,
  member,
  type GitHubAppInstallation,
  type GitHubRepositoryGrant
} from "./db/schema.js";

export const GITHUB_APP_CREDENTIAL_REF = "org:github-app";
export const GITHUB_APP_SETUP_ERROR = "GitHub App is not installed for this organization/repository.";

type Fetch = typeof fetch;

export type GitHubAppConfig = {
  appId: string;
  privateKey: string;
};

export type GitHubInstallationToken = {
  token: string;
  expiresAt: string;
  permissions?: Record<string, unknown>;
};

export type GitHubRepoAccess = {
  credentialRef: typeof GITHUB_APP_CREDENTIAL_REF;
  githubInstallationId: string;
  fullName: string;
  cloneUrl: string;
  htmlUrl: string;
  token: string;
  tokenExpiresAt: string;
};

export type GitHubAppAccessStore = {
  findRepositoryGrant(organizationId: string, fullName: string): Promise<GitHubRepositoryGrant | undefined>;
  findActiveInstallation(
    organizationId: string,
    githubInstallationId: string
  ): Promise<GitHubAppInstallation | undefined>;
  upsertInstallation(input: UpsertInstallationInput): Promise<void>;
  listRepositoryGrants(organizationId: string, githubInstallationId: string): Promise<GitHubRepositoryGrant[]>;
  upsertRepositoryGrant(input: UpsertRepositoryGrantInput): Promise<void>;
  markRepositoriesRemoved(input: {
    organizationId: string;
    githubInstallationId: string;
    githubRepositoryIds: string[];
    removedAt: Date;
  }): Promise<void>;
  userBelongsToOrganization(userId: string, organizationId: string): Promise<boolean>;
};

type UpsertInstallationInput = {
  organizationId: string;
  githubInstallationId: string;
  githubAccountLogin: string;
  githubAccountType: string;
  repositorySelection: string;
  permissions?: Record<string, unknown>;
  installedByUserId?: string;
  suspendedAt?: Date | null;
  revokedAt?: Date | null;
};

type UpsertRepositoryGrantInput = {
  organizationId: string;
  githubInstallationId: string;
  githubRepositoryId: string;
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string;
  cloneUrl: string;
  permissions?: Record<string, unknown>;
};

type GitHubInstallationApiResponse = {
  id: number;
  account: {
    login: string;
    type: string;
  } | null;
  repository_selection: string;
  permissions?: Record<string, unknown>;
  suspended_at?: string | null;
};

type GitHubRepositoryApiResponse = {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  html_url: string;
  clone_url: string;
  permissions?: Record<string, unknown>;
  owner: {
    login: string;
  };
};

type GitHubRepositoryListApiResponse = {
  repositories: GitHubRepositoryApiResponse[];
};

export class GitHubAppSetupError extends Error {
  constructor(message = GITHUB_APP_SETUP_ERROR) {
    super(message);
    this.name = "GitHubAppSetupError";
  }
}

export class DrizzleGitHubAppAccessStore implements GitHubAppAccessStore {
  async findRepositoryGrant(organizationId: string, fullName: string) {
    const [grant] = await db
      .select()
      .from(githubRepositoryGrants)
      .where(
        and(
          eq(githubRepositoryGrants.organizationId, organizationId),
          eq(githubRepositoryGrants.fullName, fullName),
          isNull(githubRepositoryGrants.removedAt)
        )
      )
      .limit(1);
    return grant;
  }

  async findActiveInstallation(organizationId: string, githubInstallationId: string) {
    const [installation] = await db
      .select()
      .from(githubAppInstallations)
      .where(
        and(
          eq(githubAppInstallations.organizationId, organizationId),
          eq(githubAppInstallations.githubInstallationId, githubInstallationId),
          isNull(githubAppInstallations.suspendedAt),
          isNull(githubAppInstallations.revokedAt)
        )
      )
      .limit(1);
    return installation;
  }

  async upsertInstallation(input: UpsertInstallationInput) {
    await db
      .insert(githubAppInstallations)
      .values({
        organizationId: input.organizationId,
        githubInstallationId: input.githubInstallationId,
        githubAccountLogin: input.githubAccountLogin,
        githubAccountType: input.githubAccountType,
        repositorySelection: input.repositorySelection,
        permissions: input.permissions,
        installedByUserId: input.installedByUserId,
        suspendedAt: input.suspendedAt,
        revokedAt: input.revokedAt,
        updatedAt: new Date()
      })
      .onConflictDoUpdate({
        target: githubAppInstallations.githubInstallationId,
        set: {
          organizationId: input.organizationId,
          githubAccountLogin: input.githubAccountLogin,
          githubAccountType: input.githubAccountType,
          repositorySelection: input.repositorySelection,
          permissions: input.permissions,
          installedByUserId: input.installedByUserId,
          suspendedAt: input.suspendedAt,
          revokedAt: input.revokedAt,
          updatedAt: new Date()
        }
      });
  }

  async listRepositoryGrants(organizationId: string, githubInstallationId: string) {
    return db
      .select()
      .from(githubRepositoryGrants)
      .where(
        and(
          eq(githubRepositoryGrants.organizationId, organizationId),
          eq(githubRepositoryGrants.githubInstallationId, githubInstallationId),
          isNull(githubRepositoryGrants.removedAt)
        )
      );
  }

  async upsertRepositoryGrant(input: UpsertRepositoryGrantInput) {
    await db
      .insert(githubRepositoryGrants)
      .values({
        organizationId: input.organizationId,
        githubInstallationId: input.githubInstallationId,
        githubRepositoryId: input.githubRepositoryId,
        owner: input.owner,
        name: input.name,
        fullName: input.fullName,
        private: input.private,
        defaultBranch: input.defaultBranch,
        htmlUrl: input.htmlUrl,
        cloneUrl: input.cloneUrl,
        permissions: input.permissions,
        removedAt: null,
        updatedAt: new Date()
      })
      .onConflictDoUpdate({
        target: [githubRepositoryGrants.organizationId, githubRepositoryGrants.githubRepositoryId],
        set: {
          githubInstallationId: input.githubInstallationId,
          owner: input.owner,
          name: input.name,
          fullName: input.fullName,
          private: input.private,
          defaultBranch: input.defaultBranch,
          htmlUrl: input.htmlUrl,
          cloneUrl: input.cloneUrl,
          permissions: input.permissions,
          removedAt: null,
          updatedAt: new Date()
        }
      });
  }

  async markRepositoriesRemoved(input: {
    organizationId: string;
    githubInstallationId: string;
    githubRepositoryIds: string[];
    removedAt: Date;
  }) {
    const existing = await this.listRepositoryGrants(input.organizationId, input.githubInstallationId);
    const removed = existing.filter((grant) => !input.githubRepositoryIds.includes(grant.githubRepositoryId));

    for (const grant of removed) {
      await db
        .update(githubRepositoryGrants)
        .set({ removedAt: input.removedAt, updatedAt: input.removedAt })
        .where(eq(githubRepositoryGrants.id, grant.id));
    }
  }

  async userBelongsToOrganization(userId: string, organizationId: string) {
    const [membership] = await db
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)))
      .limit(1);
    return Boolean(membership);
  }
}

const defaultStore = new DrizzleGitHubAppAccessStore();

export function githubAppConfigFromEnv(env: NodeJS.ProcessEnv = process.env): GitHubAppConfig {
  const appId = env.GITHUB_APP_ID?.trim();
  const privateKey = env.GITHUB_APP_PRIVATE_KEY?.trim();

  if (!appId || !privateKey) {
    throw new Error("GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY are required for GitHub App repo access.");
  }

  return {
    appId,
    privateKey: privateKey.replaceAll("\\n", "\n")
  };
}

function base64url(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

export function createGitHubAppJwt(config: GitHubAppConfig, nowSeconds = Math.floor(Date.now() / 1000)) {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      iat: nowSeconds - 60,
      exp: nowSeconds + 9 * 60,
      iss: config.appId
    })
  );
  const unsigned = `${header}.${payload}`;
  const signature = crypto.createSign("RSA-SHA256").update(unsigned).sign(config.privateKey);
  return `${unsigned}.${base64url(signature)}`;
}

async function githubRequest<T>(
  path: string,
  options: {
    method?: string;
    token: string;
    body?: unknown;
    fetch?: Fetch;
  }
): Promise<T> {
  const response = await (options.fetch ?? fetch)(`https://api.github.com${path}`, {
    method: options.method ?? "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${options.token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": process.env.GITHUB_API_VERSION ?? "2026-03-10"
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  if (!response.ok) {
    const body = redactSecrets(await response.text());
    throw new Error(`GitHub API request failed (${response.status}) for ${path}: ${body}`);
  }

  return (await response.json()) as T;
}

export async function mintGitHubInstallationToken(
  githubInstallationId: string,
  options: {
    config?: GitHubAppConfig;
    fetch?: Fetch;
  } = {}
): Promise<GitHubInstallationToken> {
  const appJwt = createGitHubAppJwt(options.config ?? githubAppConfigFromEnv());
  const response = await githubRequest<{
    token: string;
    expires_at: string;
    permissions?: Record<string, unknown>;
  }>(`/app/installations/${githubInstallationId}/access_tokens`, {
    method: "POST",
    token: appJwt,
    fetch: options.fetch
  });

  return {
    token: response.token,
    expiresAt: response.expires_at,
    permissions: response.permissions
  };
}

export function normalizeGitHubRepoFullName(input: string) {
  const trimmed = input.trim();
  const withoutGitSuffix = trimmed.endsWith(".git") ? trimmed.slice(0, -4) : trimmed;
  const httpsMatch = withoutGitSuffix.match(/^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)$/i);
  const sshMatch = withoutGitSuffix.match(/^git@github\.com:([^/\s]+)\/([^/\s]+)$/i);
  const ownerNameMatch = withoutGitSuffix.match(/^([^/\s]+)\/([^/\s]+)$/);
  const match = httpsMatch ?? sshMatch ?? ownerNameMatch;
  if (!match) throw new Error(`Expected a GitHub repository owner/name or URL, received: ${input}`);
  return `${match[1]}/${match[2]}`;
}

export function cleanGitHubCloneUrl(fullName: string) {
  return `https://github.com/${normalizeGitHubRepoFullName(fullName)}.git`;
}

export async function resolveGitHubRepoAccess(
  input: {
    organizationId: string;
    repo: string;
  },
  options: {
    store?: GitHubAppAccessStore;
    mintInstallationToken?: typeof mintGitHubInstallationToken;
  } = {}
): Promise<GitHubRepoAccess> {
  const store = options.store ?? defaultStore;
  const fullName = normalizeGitHubRepoFullName(input.repo);
  const grant = await store.findRepositoryGrant(input.organizationId, fullName);
  if (!grant) throw new GitHubAppSetupError();

  const installation = await store.findActiveInstallation(input.organizationId, grant.githubInstallationId);
  if (!installation) throw new GitHubAppSetupError();

  const token = await (options.mintInstallationToken ?? mintGitHubInstallationToken)(grant.githubInstallationId);

  return {
    credentialRef: GITHUB_APP_CREDENTIAL_REF,
    githubInstallationId: grant.githubInstallationId,
    fullName,
    cloneUrl: cleanGitHubCloneUrl(fullName),
    htmlUrl: grant.htmlUrl,
    token: token.token,
    tokenExpiresAt: token.expiresAt
  };
}

export async function assertOrganizationMembership(
  userId: string,
  organizationId: string,
  options: { store?: GitHubAppAccessStore } = {}
) {
  const belongs = await (options.store ?? defaultStore).userBelongsToOrganization(userId, organizationId);
  if (!belongs) throw new Error("User is not a member of the requested WorkPowers organization.");
}

async function listInstallationRepositories(
  token: string,
  options: { fetch?: Fetch } = {}
): Promise<GitHubRepositoryApiResponse[]> {
  const repositories: GitHubRepositoryApiResponse[] = [];
  let page = 1;

  while (true) {
    const response = await githubRequest<GitHubRepositoryListApiResponse>(
      `/installation/repositories?per_page=100&page=${page}`,
      { token, fetch: options.fetch }
    );
    repositories.push(...response.repositories);
    if (response.repositories.length < 100) return repositories;
    page += 1;
  }
}

export async function syncGitHubInstallationRepositories(
  input: {
    organizationId: string;
    githubInstallationId: string;
    installedByUserId?: string;
  },
  options: {
    store?: GitHubAppAccessStore;
    config?: GitHubAppConfig;
    fetch?: Fetch;
    mintInstallationToken?: typeof mintGitHubInstallationToken;
  } = {}
) {
  const store = options.store ?? defaultStore;
  const appJwt = createGitHubAppJwt(options.config ?? githubAppConfigFromEnv());
  const installation = await githubRequest<GitHubInstallationApiResponse>(
    `/app/installations/${input.githubInstallationId}`,
    { token: appJwt, fetch: options.fetch }
  );

  if (!installation.account) {
    throw new Error(`GitHub installation ${input.githubInstallationId} does not have an account.`);
  }

  await store.upsertInstallation({
    organizationId: input.organizationId,
    githubInstallationId: String(installation.id),
    githubAccountLogin: installation.account.login,
    githubAccountType: installation.account.type,
    repositorySelection: installation.repository_selection,
    permissions: installation.permissions,
    installedByUserId: input.installedByUserId,
    suspendedAt: installation.suspended_at ? new Date(installation.suspended_at) : null,
    revokedAt: null
  });

  const installationToken = await (options.mintInstallationToken ?? mintGitHubInstallationToken)(
    String(installation.id),
    { config: options.config, fetch: options.fetch }
  );
  const repositories = await listInstallationRepositories(installationToken.token, { fetch: options.fetch });

  for (const repository of repositories) {
    await store.upsertRepositoryGrant({
      organizationId: input.organizationId,
      githubInstallationId: String(installation.id),
      githubRepositoryId: String(repository.id),
      owner: repository.owner.login,
      name: repository.name,
      fullName: repository.full_name,
      private: repository.private,
      defaultBranch: repository.default_branch,
      htmlUrl: repository.html_url,
      cloneUrl: repository.clone_url,
      permissions: repository.permissions
    });
  }

  await store.markRepositoriesRemoved({
    organizationId: input.organizationId,
    githubInstallationId: String(installation.id),
    githubRepositoryIds: repositories.map((repository) => String(repository.id)),
    removedAt: new Date()
  });

  return {
    installation: {
      githubInstallationId: String(installation.id),
      githubAccountLogin: installation.account.login,
      githubAccountType: installation.account.type,
      repositorySelection: installation.repository_selection
    },
    repositories: repositories.map((repository) => ({
      githubRepositoryId: String(repository.id),
      fullName: repository.full_name,
      private: repository.private,
      defaultBranch: repository.default_branch,
      htmlUrl: repository.html_url
    }))
  };
}
