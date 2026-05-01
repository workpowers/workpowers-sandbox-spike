import { z } from "zod";

export const createSessionSchema = z.object({
  repoUrl: z.string().min(1).optional(),
  ref: z.string().default("main"),
  branchName: z.string().optional(),
  template: z.string().default("node-pnpm-playwright-postgres"),
  profilePath: z.string().min(1).optional(),
  organizationId: z.string().min(1).optional(),
  userId: z.string().min(1).optional(),
  credentialRef: z.literal("org:github-app").optional(),
  data: z
    .object({
      mode: z
        .enum(["local_seed", "curated_seed", "db_branch", "snapshot_restore"])
        .default("local_seed"),
      seedName: z.string().default("basic-projects")
    })
    .default({ mode: "local_seed", seedName: "basic-projects" })
}).refine((value) => value.repoUrl || value.profilePath, {
  message: "repoUrl or profilePath is required",
  path: ["repoUrl"]
});

export const commandSchema = z.object({
  command: z.string().min(1),
  cwd: z.string().optional(),
  timeoutSeconds: z.number().int().positive().max(600).default(60)
});

export const filePathSchema = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith("/") && !value.includes(".."), {
    message: "Path must be relative and stay inside the live fork workdir"
  });

export const fileWriteSchema = z.object({
  path: filePathSchema,
  content: z.string()
});
