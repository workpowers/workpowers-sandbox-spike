import { describe, expect, it } from "vitest";
import { redactSecrets } from "../../../packages/live-fork/src/redaction.js";
import {
  GITHUB_APP_SETUP_ERROR,
  GitHubAppSetupError,
  assertOrganizationMembership,
  cleanGitHubCloneUrl,
  normalizeGitHubRepoFullName,
  resolveGitHubRepoAccess,
  type GitHubAppAccessStore
} from "./github-app.js";

function fakeStore(options: {
  hasGrant?: boolean;
  activeInstallation?: boolean;
  member?: boolean;
} = {}): GitHubAppAccessStore {
  const hasGrant = options.hasGrant ?? true;
  const activeInstallation = options.activeInstallation ?? true;
  const member = options.member ?? true;

  return {
    async findRepositoryGrant(_organizationId, fullName) {
      if (!hasGrant || fullName !== "evanfuture/ringofbeara.com") return undefined;
      return {
        githubInstallationId: "12345",
        fullName,
        htmlUrl: "https://github.com/evanfuture/ringofbeara.com",
        cloneUrl: "https://github.com/evanfuture/ringofbeara.com.git",
        removedAt: null
      } as any;
    },
    async findActiveInstallation(_organizationId, githubInstallationId) {
      if (!activeInstallation || githubInstallationId !== "12345") return undefined;
      return {
        githubInstallationId,
        suspendedAt: null,
        revokedAt: null
      } as any;
    },
    async upsertInstallation() {
      return;
    },
    async listRepositoryGrants() {
      return [];
    },
    async upsertRepositoryGrant() {
      return;
    },
    async markRepositoriesRemoved() {
      return;
    },
    async userBelongsToOrganization() {
      return member;
    }
  };
}

describe("GitHub App repo access", () => {
  it("normalizes supported GitHub repository identifiers", () => {
    expect(normalizeGitHubRepoFullName("evanfuture/ringofbeara.com")).toBe("evanfuture/ringofbeara.com");
    expect(normalizeGitHubRepoFullName("https://github.com/evanfuture/ringofbeara.com.git")).toBe(
      "evanfuture/ringofbeara.com"
    );
    expect(normalizeGitHubRepoFullName("git@github.com:evanfuture/ringofbeara.com.git")).toBe(
      "evanfuture/ringofbeara.com"
    );
    expect(cleanGitHubCloneUrl("evanfuture/ringofbeara.com")).toBe(
      "https://github.com/evanfuture/ringofbeara.com.git"
    );
  });

  it("resolves an org repository grant through an active installation and mints a runtime token", async () => {
    const access = await resolveGitHubRepoAccess(
      {
        organizationId: "org_1",
        repo: "https://github.com/evanfuture/ringofbeara.com.git"
      },
      {
        store: fakeStore(),
        mintInstallationToken: async (githubInstallationId) => ({
          token: `ghs_${githubInstallationId}_runtime_token_1234567890`,
          expiresAt: "2026-04-30T12:00:00Z"
        })
      }
    );

    expect(access).toMatchObject({
      credentialRef: "org:github-app",
      githubInstallationId: "12345",
      fullName: "evanfuture/ringofbeara.com",
      cloneUrl: "https://github.com/evanfuture/ringofbeara.com.git"
    });
    expect(access.token).toContain("runtime_token");
  });

  it("fails with a clear setup error when the repository is not granted", async () => {
    await expect(
      resolveGitHubRepoAccess(
        { organizationId: "org_1", repo: "evanfuture/ringofbeara.com" },
        {
          store: fakeStore({ hasGrant: false }),
          mintInstallationToken: async () => {
            throw new Error("should not mint");
          }
        }
      )
    ).rejects.toThrow(new GitHubAppSetupError(GITHUB_APP_SETUP_ERROR));
  });

  it("fails with the same setup error when the installation is suspended or revoked", async () => {
    await expect(
      resolveGitHubRepoAccess(
        { organizationId: "org_1", repo: "evanfuture/ringofbeara.com" },
        {
          store: fakeStore({ activeInstallation: false }),
          mintInstallationToken: async () => {
            throw new Error("should not mint");
          }
        }
      )
    ).rejects.toThrow(GITHUB_APP_SETUP_ERROR);
  });

  it("checks WorkPowers organization membership before org GitHub access is used", async () => {
    await expect(
      assertOrganizationMembership("user_1", "org_1", { store: fakeStore({ member: false }) })
    ).rejects.toThrow("User is not a member");
  });

  it("redacts GitHub token-shaped values from logs and clone URLs", () => {
    const token = "ghs_abcdefghijklmnopqrstuvwxyz1234567890";
    expect(redactSecrets(`fatal: unable to clone https://x-access-token:${token}@github.com/org/repo.git`)).not.toContain(
      token
    );
    expect(redactSecrets(`Authorization: Bearer ${token}`)).toBe("Authorization: Bearer [REDACTED]");
  });
});
