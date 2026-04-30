import "dotenv/config";
import { eq } from "drizzle-orm";
import { APIError } from "better-auth/api";
import { auth } from "../auth.js";
import { ensurePersonalOrgForUser } from "../personal-org.js";
import { db, pool } from "./client.js";
import { projects, user } from "./schema.js";

const seedProjects = ["Onboarding rehearsal", "Billing audit", "Incident replay"];

async function seedAuthUser() {
  try {
    const result = await auth.api.signUpEmail({
      body: {
        email: "agent@example.com",
        password: "password1234",
        name: "Sandbox Agent"
      }
    });
    return result.user.id;
  } catch (error) {
    if (error instanceof APIError && error.status === "CONFLICT") {
      const [existingUser] = await db.select().from(user).where(eq(user.email, "agent@example.com")).limit(1);
      return existingUser.id;
    }
    const message = error instanceof Error ? error.message : String(error);
    if (!message.toLowerCase().includes("already")) throw error;
    const [existingUser] = await db.select().from(user).where(eq(user.email, "agent@example.com")).limit(1);
    return existingUser.id;
  }
}

async function seedProjectsTable(userId: string, orgId: string) {
  for (const name of seedProjects) {
    const existing = await db.select().from(projects).where(eq(projects.name, name)).limit(1);
    if (existing.length === 0) {
      await db.insert(projects).values({ name, creatorId: userId, orgId });
    } else if (!existing[0].orgId) {
      await db.update(projects).set({ creatorId: userId, orgId }).where(eq(projects.id, existing[0].id));
    }
  }
}

async function main() {
  const userId = await seedAuthUser();
  const orgId = await ensurePersonalOrgForUser(userId);
  if (!orgId) throw new Error(`Could not resolve personal org for ${userId}`);
  await seedProjectsTable(userId, orgId);
  console.log("Seeded agent@example.com / password1234 and basic projects");
  await pool.end();
}

main().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
