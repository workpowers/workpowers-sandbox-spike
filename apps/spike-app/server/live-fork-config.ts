import crypto from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "./db/client.js";
import {
  liveForkAppEnvironments,
  liveForkApps,
  orgCredentials,
  type LiveForkApp,
  type LiveForkAppEnvironment,
  type OrgCredential
} from "./db/schema.js";

export const WORKPOWERS_SECRET_ENCRYPTION_KEY = "WORKPOWERS_SECRET_ENCRYPTION_KEY";

export type NeonEnvironmentConfig = {
  neonProjectId: string;
  parentBranchId: string;
  databaseName: string;
  roleName: string;
  pooled: boolean;
};

export type UpsertLiveForkNeonEnvironmentInput = {
  organizationId: string;
  userId: string;
  app: {
    name: string;
    repoFullName: string;
    githubRepositoryId?: string;
    defaultBranch?: string;
    profilePath?: string;
  };
  environment: {
    name: string;
    dataConfig: NeonEnvironmentConfig;
  };
  credential: {
    label?: string;
    neonApiKey: string;
    scopes?: string[];
  };
};

export type ResolvedLiveForkAppEnvironment = {
  app: LiveForkApp;
  environment: LiveForkAppEnvironment;
  credential: OrgCredential;
  neonApiKey: string;
  neon: NeonEnvironmentConfig;
};

function encryptionKey(rawKey = process.env[WORKPOWERS_SECRET_ENCRYPTION_KEY]) {
  if (!rawKey?.trim()) {
    throw new Error(`${WORKPOWERS_SECRET_ENCRYPTION_KEY} is required to store org-owned credentials.`);
  }

  return crypto.createHash("sha256").update(rawKey).digest();
}

export function encryptSecret(secret: string, rawKey?: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(rawKey), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `wpsec:v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${ciphertext.toString("base64url")}`;
}

export function decryptSecret(secretRef: string, rawKey?: string) {
  const [prefix, version, iv, tag, ciphertext] = secretRef.split(":");
  if (prefix !== "wpsec" || version !== "v1" || !iv || !tag || !ciphertext) {
    throw new Error("Unsupported stored secret reference.");
  }

  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(rawKey), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

export function parseEnvironmentRef(environmentRef: string) {
  const [appName, environmentName] = environmentRef.split(":");
  if (!appName || !environmentName || environmentRef.split(":").length !== 2) {
    throw new Error(`Expected environmentRef in app:environment format, received ${environmentRef}`);
  }
  return { appName, environmentName };
}

export function assertNeonEnvironmentConfig(value: unknown): NeonEnvironmentConfig {
  const config = value as Partial<NeonEnvironmentConfig> | undefined;
  if (!config || typeof config !== "object") throw new Error("Neon app environment data_config is missing.");

  const required: Array<keyof NeonEnvironmentConfig> = [
    "neonProjectId",
    "parentBranchId",
    "databaseName",
    "roleName"
  ];

  for (const key of required) {
    if (typeof config[key] !== "string" || !config[key]?.trim()) {
      throw new Error(`Neon app environment data_config.${key} is required.`);
    }
  }

  return {
    neonProjectId: config.neonProjectId as string,
    parentBranchId: config.parentBranchId as string,
    databaseName: config.databaseName as string,
    roleName: config.roleName as string,
    pooled: Boolean(config.pooled)
  };
}

export class DrizzleLiveForkConfigStore {
  async upsertNeonEnvironment(input: UpsertLiveForkNeonEnvironmentInput) {
    const [credential] = await db
      .insert(orgCredentials)
      .values({
        organizationId: input.organizationId,
        provider: "neon",
        label: input.credential.label ?? `${input.app.name}:${input.environment.name}`,
        sourceType: "stored_secret",
        secretRef: encryptSecret(input.credential.neonApiKey),
        grantedByUserId: input.userId,
        scopes: input.credential.scopes ?? ["branches:create", "branches:delete", "connection_uri:read"],
        revokedAt: null,
        updatedAt: new Date()
      })
      .onConflictDoUpdate({
        target: [orgCredentials.organizationId, orgCredentials.provider, orgCredentials.label],
        set: {
          sourceType: "stored_secret",
          secretRef: encryptSecret(input.credential.neonApiKey),
          grantedByUserId: input.userId,
          scopes: input.credential.scopes ?? ["branches:create", "branches:delete", "connection_uri:read"],
          revokedAt: null,
          updatedAt: new Date()
        }
      })
      .returning();

    const [app] = await db
      .insert(liveForkApps)
      .values({
        organizationId: input.organizationId,
        name: input.app.name,
        repoFullName: input.app.repoFullName,
        githubRepositoryId: input.app.githubRepositoryId,
        defaultBranch: input.app.defaultBranch ?? "main",
        profilePath: input.app.profilePath,
        updatedAt: new Date()
      })
      .onConflictDoUpdate({
        target: [liveForkApps.organizationId, liveForkApps.name],
        set: {
          repoFullName: input.app.repoFullName,
          githubRepositoryId: input.app.githubRepositoryId,
          defaultBranch: input.app.defaultBranch ?? "main",
          profilePath: input.app.profilePath,
          updatedAt: new Date()
        }
      })
      .returning();

    const [environment] = await db
      .insert(liveForkAppEnvironments)
      .values({
        organizationId: input.organizationId,
        appId: app.id,
        name: input.environment.name,
        dataProvider: "neon",
        dataConfig: input.environment.dataConfig,
        credentialId: credential.id,
        updatedAt: new Date()
      })
      .onConflictDoUpdate({
        target: [liveForkAppEnvironments.organizationId, liveForkAppEnvironments.appId, liveForkAppEnvironments.name],
        set: {
          dataProvider: "neon",
          dataConfig: input.environment.dataConfig,
          credentialId: credential.id,
          updatedAt: new Date()
        }
      })
      .returning();

    return { app, environment, credential };
  }

  async resolveEnvironment(
    organizationId: string,
    environmentRef: string
  ): Promise<ResolvedLiveForkAppEnvironment> {
    const { appName, environmentName } = parseEnvironmentRef(environmentRef);
    const [row] = await db
      .select({
        app: liveForkApps,
        environment: liveForkAppEnvironments,
        credential: orgCredentials
      })
      .from(liveForkAppEnvironments)
      .innerJoin(liveForkApps, eq(liveForkAppEnvironments.appId, liveForkApps.id))
      .innerJoin(orgCredentials, eq(liveForkAppEnvironments.credentialId, orgCredentials.id))
      .where(
        and(
          eq(liveForkApps.organizationId, organizationId),
          eq(liveForkApps.name, appName),
          eq(liveForkAppEnvironments.organizationId, organizationId),
          eq(liveForkAppEnvironments.name, environmentName),
          eq(liveForkAppEnvironments.dataProvider, "neon"),
          eq(orgCredentials.provider, "neon"),
          isNull(orgCredentials.revokedAt)
        )
      )
      .limit(1);

    if (!row) {
      throw new Error(`Neon app environment ${environmentRef} is not configured for this organization.`);
    }

    return {
      ...row,
      neonApiKey: decryptSecret(row.credential.secretRef),
      neon: assertNeonEnvironmentConfig(row.environment.dataConfig)
    };
  }
}
