import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "./db/client.js";
import { member, organization } from "./db/schema.js";
import { isPersonalOrg, ORG_NAME_MAX_LENGTH } from "./org-utils.js";

type UserIdentity = {
  id: string;
  name: string | null;
  email: string;
};

type PersonalOrgDatabase = Pick<typeof db, "insert" | "select" | "query">;

function buildPersonalOrgName(name: string | null | undefined, email: string): string {
  const fallbackName = email.split("@")[0] || "Workspace";
  const baseName = (name?.trim() || fallbackName).slice(0, ORG_NAME_MAX_LENGTH - " Workspace".length - 1);
  return `${baseName}'s Workspace`;
}

function buildPersonalOrgSlug(name: string | null | undefined, email: string): string {
  const base = (name?.trim() || email.split("@")[0] || "workspace")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return `${base || "workspace"}-${crypto.randomUUID().slice(0, 8)}`;
}

export function createPersonalOrgService(database: PersonalOrgDatabase = db) {
  async function findPersonalOrgId(userId: string): Promise<string | null> {
    const memberships = await database
      .select({
        organizationId: member.organizationId,
        metadata: organization.metadata
      })
      .from(member)
      .innerJoin(organization, eq(member.organizationId, organization.id))
      .where(eq(member.userId, userId));

    const personalMembership = memberships.find((entry) => isPersonalOrg({ metadata: entry.metadata }));
    return personalMembership?.organizationId ?? null;
  }

  async function createPersonalOrgForUser(identity: UserIdentity): Promise<string> {
    const orgId = crypto.randomUUID();

    await database.insert(organization).values({
      id: orgId,
      name: buildPersonalOrgName(identity.name, identity.email),
      slug: buildPersonalOrgSlug(identity.name, identity.email),
      metadata: JSON.stringify({ personal: true })
    });

    await database.insert(member).values({
      id: crypto.randomUUID(),
      userId: identity.id,
      organizationId: orgId,
      role: "owner"
    });

    return orgId;
  }

  async function ensurePersonalOrgForUser(userId: string, identity?: UserIdentity): Promise<string | null> {
    const existingOrgId = await findPersonalOrgId(userId);
    if (existingOrgId) return existingOrgId;

    const userIdentity =
      identity ??
      (await database.query.user.findFirst({
        where: (u, { eq: equals }) => equals(u.id, userId),
        columns: {
          id: true,
          name: true,
          email: true
        }
      }));

    if (!userIdentity?.email) return null;

    return createPersonalOrgForUser(userIdentity);
  }

  return {
    ensurePersonalOrgForUser,
    findPersonalOrgId
  };
}

export const { ensurePersonalOrgForUser, findPersonalOrgId } = createPersonalOrgService();
