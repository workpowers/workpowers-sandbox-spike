import { relations } from "drizzle-orm";
import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull()
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    activeOrganizationId: text("active_organization_id")
  },
  (table) => [index("session_user_id_idx").on(table.userId)]
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .$onUpdate(() => new Date())
      .notNull()
  },
  (table) => [
    index("account_user_id_idx").on(table.userId),
    index("account_user_provider_idx").on(table.userId, table.providerId)
  ]
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull()
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)]
);

export const organization = pgTable(
  "organization",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    logo: text("logo"),
    metadata: text("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [uniqueIndex("organization_slug_idx").on(table.slug)]
);

export const member = pgTable(
  "member",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    index("member_user_id_idx").on(table.userId),
    index("member_organization_id_idx").on(table.organizationId),
    uniqueIndex("member_user_organization_idx").on(table.userId, table.organizationId)
  ]
);

export const invitation = pgTable(
  "invitation",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    status: text("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [index("invitation_organization_id_idx").on(table.organizationId)]
);

export const projects = pgTable("projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  orgId: text("org_id").references(() => organization.id, { onDelete: "cascade" }),
  creatorId: text("creator_id").references(() => user.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

export const githubAppInstallations = pgTable(
  "github_app_installations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    githubInstallationId: text("github_installation_id").notNull(),
    githubAccountLogin: text("github_account_login").notNull(),
    githubAccountType: text("github_account_type").notNull(),
    repositorySelection: text("repository_selection").notNull(),
    permissions: jsonb("permissions").$type<Record<string, unknown>>(),
    installedByUserId: text("installed_by_user_id").references(() => user.id, { onDelete: "set null" }),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull()
  },
  (table) => [
    uniqueIndex("github_app_installations_installation_idx").on(table.githubInstallationId),
    index("github_app_installations_organization_idx").on(table.organizationId)
  ]
);

export const githubRepositoryGrants = pgTable(
  "github_repository_grants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    githubInstallationId: text("github_installation_id").notNull(),
    githubRepositoryId: text("github_repository_id").notNull(),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    fullName: text("full_name").notNull(),
    private: boolean("private").notNull(),
    defaultBranch: text("default_branch").notNull(),
    htmlUrl: text("html_url").notNull(),
    cloneUrl: text("clone_url").notNull(),
    permissions: jsonb("permissions").$type<Record<string, unknown>>(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull()
  },
  (table) => [
    uniqueIndex("github_repository_grants_org_repo_idx").on(table.organizationId, table.githubRepositoryId),
    index("github_repository_grants_org_full_name_idx").on(table.organizationId, table.fullName),
    index("github_repository_grants_installation_idx").on(table.organizationId, table.githubInstallationId)
  ]
);

export const orgCredentials = pgTable(
  "org_credentials",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    label: text("label").notNull(),
    sourceType: text("source_type").notNull(),
    secretRef: text("secret_ref").notNull(),
    grantedByUserId: text("granted_by_user_id").references(() => user.id, { onDelete: "set null" }),
    scopes: jsonb("scopes").$type<string[]>(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull()
  },
  (table) => [
    index("org_credentials_organization_idx").on(table.organizationId),
    index("org_credentials_provider_idx").on(table.organizationId, table.provider),
    uniqueIndex("org_credentials_org_provider_label_idx").on(table.organizationId, table.provider, table.label)
  ]
);

export const liveForkApps = pgTable(
  "live_fork_apps",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    repoFullName: text("repo_full_name").notNull(),
    githubRepositoryId: text("github_repository_id"),
    defaultBranch: text("default_branch").notNull().default("main"),
    profilePath: text("profile_path"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull()
  },
  (table) => [
    uniqueIndex("live_fork_apps_org_name_idx").on(table.organizationId, table.name),
    uniqueIndex("live_fork_apps_org_repo_idx").on(table.organizationId, table.repoFullName)
  ]
);

export const liveForkAppEnvironments = pgTable(
  "live_fork_app_environments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    appId: uuid("app_id")
      .notNull()
      .references(() => liveForkApps.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    dataProvider: text("data_provider").notNull(),
    dataConfig: jsonb("data_config").$type<Record<string, unknown>>().notNull(),
    credentialId: uuid("credential_id").references(() => orgCredentials.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull()
  },
  (table) => [
    uniqueIndex("live_fork_app_environments_org_app_name_idx").on(table.organizationId, table.appId, table.name),
    index("live_fork_app_environments_org_idx").on(table.organizationId)
  ]
);

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  memberships: many(member)
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id]
  })
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id]
  })
}));

export const organizationRelations = relations(organization, ({ many }) => ({
  members: many(member),
  invitations: many(invitation),
  projects: many(projects),
  githubAppInstallations: many(githubAppInstallations),
  githubRepositoryGrants: many(githubRepositoryGrants),
  orgCredentials: many(orgCredentials),
  liveForkApps: many(liveForkApps),
  liveForkAppEnvironments: many(liveForkAppEnvironments)
}));

export const memberRelations = relations(member, ({ one }) => ({
  user: one(user, {
    fields: [member.userId],
    references: [user.id]
  }),
  organization: one(organization, {
    fields: [member.organizationId],
    references: [organization.id]
  })
}));

export const invitationRelations = relations(invitation, ({ one }) => ({
  inviter: one(user, {
    fields: [invitation.inviterId],
    references: [user.id]
  }),
  organization: one(organization, {
    fields: [invitation.organizationId],
    references: [organization.id]
  })
}));

export const projectRelations = relations(projects, ({ one }) => ({
  organization: one(organization, {
    fields: [projects.orgId],
    references: [organization.id]
  }),
  creator: one(user, {
    fields: [projects.creatorId],
    references: [user.id]
  })
}));

export const githubAppInstallationRelations = relations(githubAppInstallations, ({ one }) => ({
  organization: one(organization, {
    fields: [githubAppInstallations.organizationId],
    references: [organization.id]
  }),
  installedByUser: one(user, {
    fields: [githubAppInstallations.installedByUserId],
    references: [user.id]
  })
}));

export const githubRepositoryGrantRelations = relations(githubRepositoryGrants, ({ one }) => ({
  organization: one(organization, {
    fields: [githubRepositoryGrants.organizationId],
    references: [organization.id]
  })
}));

export const orgCredentialRelations = relations(orgCredentials, ({ one }) => ({
  organization: one(organization, {
    fields: [orgCredentials.organizationId],
    references: [organization.id]
  }),
  grantedByUser: one(user, {
    fields: [orgCredentials.grantedByUserId],
    references: [user.id]
  })
}));

export const liveForkAppRelations = relations(liveForkApps, ({ one, many }) => ({
  organization: one(organization, {
    fields: [liveForkApps.organizationId],
    references: [organization.id]
  }),
  environments: many(liveForkAppEnvironments)
}));

export const liveForkAppEnvironmentRelations = relations(liveForkAppEnvironments, ({ one }) => ({
  organization: one(organization, {
    fields: [liveForkAppEnvironments.organizationId],
    references: [organization.id]
  }),
  app: one(liveForkApps, {
    fields: [liveForkAppEnvironments.appId],
    references: [liveForkApps.id]
  }),
  credential: one(orgCredentials, {
    fields: [liveForkAppEnvironments.credentialId],
    references: [orgCredentials.id]
  })
}));

export type Project = typeof projects.$inferSelect;
export type GitHubAppInstallation = typeof githubAppInstallations.$inferSelect;
export type GitHubRepositoryGrant = typeof githubRepositoryGrants.$inferSelect;
export type OrgCredential = typeof orgCredentials.$inferSelect;
export type LiveForkApp = typeof liveForkApps.$inferSelect;
export type LiveForkAppEnvironment = typeof liveForkAppEnvironments.$inferSelect;
