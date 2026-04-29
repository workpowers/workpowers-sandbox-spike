import "dotenv/config";
import { getMigrations } from "better-auth/db/migration";
import { sql } from "drizzle-orm";
import { authConfig } from "../auth.js";
import { db, pool } from "./client.js";

async function main() {
  const migrations = await getMigrations(authConfig);
  await migrations.runMigrations();

  await db.execute(sql`
    create table if not exists projects (
      id uuid primary key default gen_random_uuid(),
      name text not null,
      created_at timestamptz not null default now()
    )
  `);

  console.log("Database migrated");
  await pool.end();
}

main().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
