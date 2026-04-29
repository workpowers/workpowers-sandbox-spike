import "dotenv/config";
import cors from "cors";
import express from "express";
import { desc } from "drizzle-orm";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import { auth } from "./auth.js";
import { db } from "./db/client.js";
import { projects } from "./db/schema.js";

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

app.get("/api/projects", async (req, res) => {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers)
  });

  if (!session?.user) return res.status(401).json({ error: "not_authenticated" });

  const rows = await db.select().from(projects).orderBy(desc(projects.createdAt));
  res.json({ projects: rows });
});

app.post("/api/projects", async (req, res) => {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers)
  });

  if (!session?.user) return res.status(401).json({ error: "not_authenticated" });

  const name = String(req.body.name ?? "").trim();
  if (!name) return res.status(422).json({ error: "name_required" });

  const [project] = await db.insert(projects).values({ name }).returning();
  return res.status(201).json({ project });
});

app.listen(port, () => {
  console.log(`Spike API listening on http://localhost:${port}`);
});
