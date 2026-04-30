import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://workpowers:workpowers@localhost:5432/workpowers_live_fork"
});

export const db = drizzle(pool, {
  schema
});
