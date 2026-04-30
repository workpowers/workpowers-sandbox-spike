import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { authConfig } from "./auth.js";
import { createPersonalOrgService } from "./personal-org.js";
import { isPersonalOrg, parseOrgMetadata } from "./org-utils.js";
import { invitation, member, organization, projects, session } from "./db/schema.js";

function mockSelectRows(rows: Array<{ organizationId: string; metadata: string | null }>) {
  return {
    from: () => ({
      innerJoin: () => ({
        where: async () => rows
      })
    })
  };
}

describe("auth and organization foundation", () => {
  it("defines the better-auth organization tables and active org session column", () => {
    expect(getTableColumns(session).activeOrganizationId).toBeDefined();

    const orgColumns = getTableColumns(organization);
    expect(orgColumns.name).toBeDefined();
    expect(orgColumns.slug).toBeDefined();
    expect(orgColumns.metadata).toBeDefined();

    expect(getTableColumns(member).organizationId).toBeDefined();
    expect(getTableColumns(member).role).toBeDefined();
    expect(getTableColumns(invitation).email).toBeDefined();
  });

  it("scopes projects to organizations while preserving creator attribution", () => {
    const projectColumns = getTableColumns(projects);

    expect(projectColumns.orgId).toBeDefined();
    expect(projectColumns.creatorId).toBeDefined();
  });

  it("recognizes personal organization metadata from Better Auth storage", () => {
    expect(parseOrgMetadata(JSON.stringify({ personal: true }))).toEqual({ personal: true });
    expect(isPersonalOrg({ metadata: JSON.stringify({ personal: true }) })).toBe(true);
    expect(isPersonalOrg({ metadata: "{bad json" })).toBe(false);
  });

  it("keeps production auth decisions wired into the spike auth config", () => {
    expect(authConfig.emailAndPassword.enabled).toBe(true);
    expect(authConfig.account.accountLinking).toMatchObject({
      enabled: true,
      trustedProviders: ["github"],
      allowDifferentEmails: true
    });
    expect(authConfig.plugins).toHaveLength(1);
  });

  it("returns an existing personal org without creating another one", async () => {
    const inserts: unknown[] = [];
    const service = createPersonalOrgService({
      select: () => mockSelectRows([{ organizationId: "org-existing", metadata: JSON.stringify({ personal: true }) }]),
      insert: () => ({
        values: async (value: unknown) => inserts.push(value)
      }),
      query: {
        user: {
          findFirst: async () => null
        }
      }
    } as any);

    await expect(service.ensurePersonalOrgForUser("user-1")).resolves.toBe("org-existing");
    expect(inserts).toHaveLength(0);
  });

  it("creates a personal owner org when one is missing", async () => {
    const inserts: unknown[] = [];
    const service = createPersonalOrgService({
      select: () => mockSelectRows([]),
      insert: () => ({
        values: async (value: unknown) => inserts.push(value)
      }),
      query: {
        user: {
          findFirst: async () => ({
            id: "user-2",
            name: "Sandbox Agent",
            email: "agent@example.com"
          })
        }
      }
    } as any);

    const orgId = await service.ensurePersonalOrgForUser("user-2");

    expect(orgId).toEqual(expect.any(String));
    expect(inserts[0]).toMatchObject({
      id: orgId,
      name: "Sandbox Agent's Workspace",
      metadata: JSON.stringify({ personal: true })
    });
    expect(inserts[1]).toMatchObject({
      userId: "user-2",
      organizationId: orgId,
      role: "owner"
    });
  });
});
