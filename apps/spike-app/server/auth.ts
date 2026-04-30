import "dotenv/config";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization as organizationPlugin } from "better-auth/plugins";
import { pool } from "./db/client.js";
import { db } from "./db/client.js";
import { account, invitation, member, organization, session, user, verification } from "./db/schema.js";
import { ensurePersonalOrgForUser } from "./personal-org.js";

const trustedOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3002",
  "http://127.0.0.1:3002",
  "http://localhost:3001",
  process.env.PUBLIC_PREVIEW_URL
].filter((origin): origin is string => Boolean(origin));

const socialProviders =
  process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
    ? {
        github: {
          clientId: process.env.GITHUB_CLIENT_ID,
          clientSecret: process.env.GITHUB_CLIENT_SECRET,
          scope: ["read:user", "user:email", "repo"]
        }
      }
    : {};

const authSchema = {
  user,
  session,
  account,
  verification,
  organization,
  member,
  invitation
};

const snakeCaseFieldMapping = {
  user: {
    fields: {
      emailVerified: "email_verified",
      createdAt: "created_at",
      updatedAt: "updated_at"
    }
  },
  session: {
    fields: {
      expiresAt: "expires_at",
      ipAddress: "ip_address",
      userAgent: "user_agent",
      userId: "user_id",
      createdAt: "created_at",
      updatedAt: "updated_at"
    }
  },
  account: {
    fields: {
      accountId: "account_id",
      providerId: "provider_id",
      userId: "user_id",
      accessToken: "access_token",
      refreshToken: "refresh_token",
      idToken: "id_token",
      accessTokenExpiresAt: "access_token_expires_at",
      refreshTokenExpiresAt: "refresh_token_expires_at",
      createdAt: "created_at",
      updatedAt: "updated_at"
    }
  },
  verification: {
    fields: {
      expiresAt: "expires_at",
      createdAt: "created_at",
      updatedAt: "updated_at"
    }
  }
};

const organizationSchemaMapping = {
  session: {
    fields: {
      activeOrganizationId: "active_organization_id"
    }
  },
  organization: {
    fields: {
      createdAt: "created_at"
    }
  },
  member: {
    fields: {
      userId: "user_id",
      organizationId: "organization_id",
      createdAt: "created_at"
    }
  },
  invitation: {
    fields: {
      inviterId: "inviter_id",
      organizationId: "organization_id",
      expiresAt: "expires_at",
      createdAt: "created_at"
    }
  }
};

type CreatedAuthUser = {
  id: string;
  name?: string | null;
  email: string;
};

type SessionWithActiveOrganization = {
  userId: string;
  activeOrganizationId?: string | null;
};

function createOrganizationPlugin({ mapFields }: { mapFields: boolean }) {
  return organizationPlugin({
    allowUserToCreateOrganization: true,
    creatorRole: "owner",
    ...(mapFields ? { schema: organizationSchemaMapping } : {}),
    sendInvitationEmail: async ({ invitation: inv, organization: org }) => {
      console.log(`[org] Invitation created for ${inv.email} in "${org.name}" (email transport not configured)`);
    }
  });
}

const baseAuthConfig = {
  appName: "WorkPowers Live Fork Spike",
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3001",
  trustedOrigins,
  secret: process.env.BETTER_AUTH_SECRET ?? "dev-secret-dev-secret-dev-secret-dev-secret",
  emailAndPassword: {
    enabled: true
  },
  socialProviders,
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["github"],
      allowDifferentEmails: true
    }
  },
  databaseHooks: {
    user: {
      create: {
        after: async (createdUser: CreatedAuthUser) => {
          await ensurePersonalOrgForUser(createdUser.id, {
            id: createdUser.id,
            name: createdUser.name ?? null,
            email: createdUser.email
          });
        }
      }
    },
    session: {
      create: {
        before: async (sessionData: SessionWithActiveOrganization) => {
          if (sessionData.activeOrganizationId) return { data: sessionData };

          const activeOrganizationId = await ensurePersonalOrgForUser(sessionData.userId);
          return {
            data: {
              ...sessionData,
              activeOrganizationId
            }
          };
        }
      }
    }
  }
};

export const authConfig = {
  ...baseAuthConfig,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: authSchema
  }),
  plugins: [createOrganizationPlugin({ mapFields: false })]
};

export const migrationAuthConfig = {
  ...baseAuthConfig,
  ...snakeCaseFieldMapping,
  database: pool,
  plugins: [createOrganizationPlugin({ mapFields: true })]
};

export const auth = betterAuth(authConfig);
