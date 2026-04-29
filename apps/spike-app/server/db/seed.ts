import "dotenv/config";
import { eq } from "drizzle-orm";
import { APIError } from "better-auth/api";
import { auth } from "../auth.js";
import { db, pool } from "./client.js";
import { projects } from "./schema.js";

const seedProjects = ["Onboarding rehearsal", "Billing audit", "Incident replay"];

async function seedAuthUser() {
  try {
    await auth.api.signUpEmail({
      body: {
        email: "agent@example.com",
        password: "password1234",
        name: "Sandbox Agent"
      }
    });
  } catch (error) {
    if (error instanceof APIError && error.status === "CONFLICT") return;
    const message = error instanceof Error ? error.message : String(error);
    if (!message.toLowerCase().includes("already")) throw error;
  }
}

async function seedProjectsTable() {
  for (const name of seedProjects) {
    const existing = await db.select().from(projects).where(eq(projects.name, name)).limit(1);
    if (existing.length === 0) {
      await db.insert(projects).values({ name });
    }
  }
}

async function main() {
  await seedAuthUser();
  await seedProjectsTable();
  console.log("Seeded agent@example.com / password1234 and basic projects");
  await pool.end();
}

main().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
