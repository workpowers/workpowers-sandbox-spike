import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";

const serviceSchema = z.object({
  command: z.string().min(1),
  port: z.number().int().positive(),
  preview: z.boolean().default(false),
  healthcheck: z.string().min(1)
});

export const liveForkProfileSchema = z.object({
  name: z.string().min(1),
  repo: z.object({
    provider: z.literal("github"),
    owner: z.string().min(1),
    name: z.string().min(1),
    credentialRef: z.literal("org:github-app").optional()
  }),
  runtime: z.object({
    provider: z.literal("daytona").default("daytona"),
    image: z.string().min(1).optional(),
    snapshot: z.string().min(1).optional(),
    resources: z.object({
      cpu: z.number().positive().default(2),
      memoryGb: z.number().positive().default(4),
      diskGb: z.number().positive().default(10)
    }).default({ cpu: 2, memoryGb: 4, diskGb: 10 })
  }).default({ provider: "daytona", resources: { cpu: 2, memoryGb: 4, diskGb: 10 } }),
  install: z.object({
    command: z.string().min(1)
  }).default({ command: "pnpm install" }),
  setup: z.object({
    commands: z.array(z.string()).default([])
  }).default({ commands: [] }),
  services: z.record(z.string(), serviceSchema).default({}),
  data: z.object({
    primary: z.object({
      kind: z.enum(["local_seed", "branch"]).default("local_seed"),
      provider: z.enum(["local", "neon"]).default("local"),
      environmentRef: z.string().min(1).optional()
    }).default({ kind: "local_seed", provider: "local" })
  }).default({ primary: { kind: "local_seed", provider: "local" } }),
  env: z.object({
    required: z.array(z.string()).default([])
  }).default({ required: [] }),
  agent: z.object({
    daemon: z.object({
      command: z.string().min(1).default("pnpm dev:daemon"),
      port: z.number().int().positive().default(8790)
    }).default({ command: "pnpm dev:daemon", port: 8790 })
  }).default({ daemon: { command: "pnpm dev:daemon", port: 8790 } }),
  checks: z.object({
    playwright: z.object({
      command: z.string().min(1),
      targetUrl: z.string().min(1)
    }).optional()
  }).default({}),
  lifecycle: z.object({
    ttlMinutes: z.number().int().positive().default(120),
    idleTimeoutMinutes: z.number().int().positive().default(30)
  }).default({ ttlMinutes: 120, idleTimeoutMinutes: 30 })
});

export type LiveForkProfile = z.infer<typeof liveForkProfileSchema>;

type YamlContainer = Record<string, unknown> | unknown[];

type StackItem = {
  indent: number;
  container: YamlContainer;
  key?: string;
};

function parseScalar(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function setValue(container: YamlContainer, key: string | undefined, value: unknown) {
  if (Array.isArray(container)) {
    container.push(value);
    return;
  }
  if (!key) throw new Error("Invalid YAML structure: missing object key");
  container[key] = value;
}

function parentFor(stack: StackItem[], indent: number) {
  while (stack.length > 1 && stack[stack.length - 1]?.indent >= indent) stack.pop();
  return stack[stack.length - 1]!;
}

export function parseLiveForkYaml(source: string): unknown {
  const root: Record<string, unknown> = {};
  const stack: StackItem[] = [{ indent: -1, container: root }];
  const lines = source.replace(/\t/g, "  ").split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index]!;
    const withoutComment = rawLine.replace(/\s+#.*$/, "");
    if (!withoutComment.trim()) continue;

    const indent = withoutComment.match(/^ */)?.[0].length ?? 0;
    const line = withoutComment.trim();
    const parent = parentFor(stack, indent);

    if (line.startsWith("- ")) {
      if (!Array.isArray(parent.container)) {
        throw new Error(`Invalid YAML list item at: ${rawLine}`);
      }
      parent.container.push(parseScalar(line.slice(2)));
      continue;
    }

    const match = line.match(/^([^:]+):(.*)$/);
    if (!match) throw new Error(`Invalid YAML line: ${rawLine}`);

    const key = match[1]!.trim();
    const rawValue = match[2]!.trim();
    if (rawValue) {
      setValue(parent.container, key, parseScalar(rawValue));
      continue;
    }

    const nextNonEmpty = lines.slice(index + 1).find((candidate) => candidate.trim());
    const child: YamlContainer = nextNonEmpty?.trim().startsWith("- ") ? [] : {};
    setValue(parent.container, key, child);
    stack.push({ indent, container: child, key });
  }

  return root;
}

export function parseLiveForkProfile(source: string) {
  return liveForkProfileSchema.parse(parseLiveForkYaml(source));
}

export async function loadLiveForkProfile(profilePath: string, rootDir = process.cwd()) {
  const resolved = path.resolve(rootDir, profilePath);
  const source = await fs.readFile(resolved, "utf8");
  return parseLiveForkProfile(source);
}

export function profileRepoUrl(profile: LiveForkProfile) {
  return `https://github.com/${profile.repo.owner}/${profile.repo.name}.git`;
}

export function previewService(profile: LiveForkProfile) {
  const entry = Object.entries(profile.services).find(([, service]) => service.preview);
  if (!entry) throw new Error(`Profile ${profile.name} does not define a preview service.`);
  return { name: entry[0], ...entry[1] };
}

export function profileToEnv(profile: LiveForkProfile, provided: Record<string, string>) {
  const missing = profile.env.required.filter((key) => !provided[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required profile env values: ${missing.join(", ")}`);
  }
  return provided;
}
