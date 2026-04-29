import { z } from "zod";

export const createSessionSchema = z.object({
  repoUrl: z.string().min(1),
  ref: z.string().default("main"),
  branchName: z.string().optional(),
  template: z.string().default("node-pnpm-playwright-postgres"),
  data: z
    .object({
      mode: z
        .enum(["local_seed", "curated_seed", "db_branch", "snapshot_restore"])
        .default("local_seed"),
      seedName: z.string().default("basic-projects")
    })
    .default({ mode: "local_seed", seedName: "basic-projects" })
});

export const commandSchema = z.object({
  command: z.string().min(1),
  cwd: z.string().optional(),
  timeoutSeconds: z.number().int().positive().max(600).default(60)
});
