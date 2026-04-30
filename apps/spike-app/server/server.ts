import "dotenv/config";
import cors from "cors";
import express from "express";
import { and, desc, eq, isNull } from "drizzle-orm";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import { redactSecrets } from "../../../packages/live-fork/src/redaction.js";
import { createSessionSchema } from "../../../packages/live-fork/src/schemas.js";
import { auth } from "./auth.js";
import { db } from "./db/client.js";
import { githubAppInstallations, githubRepositoryGrants, member, projects } from "./db/schema.js";
import { GITHUB_APP_CREDENTIAL_REF, syncGitHubInstallationRepositories } from "./github-app.js";
import { ensurePersonalOrgForUser } from "./personal-org.js";

const app = express();
const port = Number(process.env.SPIKE_API_PORT ?? 3001);

app.use(
  cors({
    origin: ["http://localhost:3000", "http://127.0.0.1:3000", process.env.PUBLIC_PREVIEW_URL].filter(Boolean) as string[],
    credentials: true
  })
);

app.all("/api/auth/{*any}", toNodeHandler(auth));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "workpowers-spike-api" });
});

app.get("/api/me", async (req, res) => {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers)
  });

  res.json({ session });
});

type AuthSession = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;

async function getAuthenticatedSession(req: express.Request, res: express.Response): Promise<AuthSession | null> {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers)
  });

  if (!session?.user) {
    res.status(401).json({ error: "not_authenticated" });
    return null;
  }

  return session;
}

async function requireActiveOrganization(session: AuthSession, res: express.Response): Promise<string | null> {
  const sessionData = session.session as typeof session.session & { activeOrganizationId?: string | null };
  const activeOrganizationId = sessionData.activeOrganizationId ?? (await ensurePersonalOrgForUser(session.user.id));

  if (!activeOrganizationId) {
    res.status(500).json({ error: "active_organization_unavailable" });
    return null;
  }

  const [membership] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.userId, session.user.id), eq(member.organizationId, activeOrganizationId)))
    .limit(1);

  if (!membership) {
    res.status(403).json({ error: "not_org_member" });
    return null;
  }

  return activeOrganizationId;
}

app.get("/api/projects", async (req, res) => {
  const session = await getAuthenticatedSession(req, res);
  if (!session) return;

  const orgId = await requireActiveOrganization(session, res);
  if (!orgId) return;

  const rows = await db.select().from(projects).where(eq(projects.orgId, orgId)).orderBy(desc(projects.createdAt));
  res.json({ projects: rows });
});

app.post("/api/projects", async (req, res) => {
  const session = await getAuthenticatedSession(req, res);
  if (!session) return;

  const orgId = await requireActiveOrganization(session, res);
  if (!orgId) return;

  const name = String(req.body.name ?? "").trim();
  if (!name) return res.status(422).json({ error: "name_required" });

  const [project] = await db.insert(projects).values({ name, creatorId: session.user.id, orgId }).returning();
  return res.status(201).json({ project });
});

app.get("/api/github/app", async (req, res) => {
  const session = await getAuthenticatedSession(req, res);
  if (!session) return;

  const orgId = await requireActiveOrganization(session, res);
  if (!orgId) return;

  const configured = Boolean(process.env.GITHUB_APP_ID && process.env.GITHUB_APP_PRIVATE_KEY);
  const installUrl =
    process.env.GITHUB_APP_INSTALL_URL ??
    (process.env.GITHUB_APP_SLUG
      ? `https://github.com/apps/${process.env.GITHUB_APP_SLUG}/installations/new?state=${encodeURIComponent(orgId)}`
      : null);

  return res.json({
    configured,
    installUrl,
    credentialRef: GITHUB_APP_CREDENTIAL_REF
  });
});

app.get("/api/github/installations", async (req, res) => {
  const session = await getAuthenticatedSession(req, res);
  if (!session) return;

  const orgId = await requireActiveOrganization(session, res);
  if (!orgId) return;

  const installations = await db
    .select()
    .from(githubAppInstallations)
    .where(
      and(
        eq(githubAppInstallations.organizationId, orgId),
        isNull(githubAppInstallations.suspendedAt),
        isNull(githubAppInstallations.revokedAt)
      )
    )
    .orderBy(desc(githubAppInstallations.updatedAt));

  const repositories = await db
    .select()
    .from(githubRepositoryGrants)
    .where(and(eq(githubRepositoryGrants.organizationId, orgId), isNull(githubRepositoryGrants.removedAt)))
    .orderBy(githubRepositoryGrants.fullName);

  return res.json({ installations, repositories });
});

app.post("/api/github/installations/sync", async (req, res, next) => {
  try {
    const session = await getAuthenticatedSession(req, res);
    if (!session) return;

    const orgId = await requireActiveOrganization(session, res);
    if (!orgId) return;

    const githubInstallationId = String(req.body.githubInstallationId ?? req.body.installationId ?? "").trim();
    if (!githubInstallationId) return res.status(422).json({ error: "github_installation_id_required" });

    const sync = await syncGitHubInstallationRepositories({
      organizationId: orgId,
      githubInstallationId,
      installedByUserId: session.user.id
    });

    return res.status(200).json(sync);
  } catch (error) {
    next(error);
  }
});

app.post("/api/live-fork-sessions", async (req, res, next) => {
  try {
    const session = await getAuthenticatedSession(req, res);
    if (!session) return;

    const orgId = await requireActiveOrganization(session, res);
    if (!orgId) return;

    const input = createSessionSchema.parse({
      ...req.body,
      organizationId: orgId,
      userId: session.user.id,
      credentialRef: req.body.credentialRef ?? GITHUB_APP_CREDENTIAL_REF
    });
    const controlPlaneUrl = process.env.CONTROL_PLANE_URL ?? "http://localhost:8787";
    const response = await fetch(`${controlPlaneUrl.replace(/\/$/, "")}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    });
    const body = await response.text();
    return res.status(response.status).type(response.headers.get("content-type") ?? "application/json").send(body);
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = redactSecrets(error instanceof Error ? error.message : String(error));
  res.status(400).json({ error: "request_failed", message });
});

app.listen(port, () => {
  console.log(`Spike API listening on http://localhost:${port}`);
});
