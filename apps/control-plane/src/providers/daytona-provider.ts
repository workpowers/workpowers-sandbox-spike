import type { CommandRequest, CommandResult, LiveForkSession } from "../../../../packages/live-fork/src/types.js";
import { emptyResult, sessionExpiry, type NormalizedCreateSessionRequest, type ProvisionedSession, type SandboxProvider } from "./provider.js";

type DaytonaSandbox = {
  id: string;
  process: {
    executeCommand(command: string, cwd?: string, env?: Record<string, string>, timeout?: number): Promise<{
      exitCode?: number;
      result?: string;
      stdout?: string;
      stderr?: string;
      artifacts?: { stdout?: string };
    }>;
  };
  getPreviewLink(port: number): Promise<{ url: string; token?: string }>;
  getSignedPreviewUrl?(port: number, expiresInSeconds?: number): Promise<{ url: string; token?: string }>;
  stop(timeout?: number): Promise<void>;
  delete(timeout?: number): Promise<void>;
};

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function normalizeResult(result: Awaited<ReturnType<DaytonaSandbox["process"]["executeCommand"]>>): CommandResult {
  return emptyResult(
    result.exitCode ?? 0,
    result.stdout ?? result.result ?? result.artifacts?.stdout ?? "",
    result.stderr ?? ""
  );
}

async function checkedCommand(sandbox: DaytonaSandbox, command: string, cwd?: string, timeoutSeconds = 60) {
  const result = normalizeResult(await sandbox.process.executeCommand(command, cwd, undefined, timeoutSeconds));
  if (result.exitCode !== 0) {
    throw new Error(
      [
        `Daytona setup command failed with exit code ${result.exitCode}`,
        `$ ${command}`,
        result.stdout,
        result.stderr
      ]
        .filter(Boolean)
        .join("\n")
    );
  }
  return result;
}

export class DaytonaSandboxProvider implements SandboxProvider {
  private readonly sandboxes = new Map<string, DaytonaSandbox>();
  private readonly workdirs = new Map<string, string>();

  async create(input: NormalizedCreateSessionRequest, sessionId: string): Promise<ProvisionedSession> {
    const { Daytona } = await import("@daytonaio/sdk");
    const daytona = new Daytona();
    const image = process.env.LIVE_FORK_TEMPLATE_IMAGE;
    const sandbox: DaytonaSandbox = await daytona.create({
      ...(image ? { image } : { language: "typescript" }),
      name: `workpowers-${sessionId}`,
      public: true,
      ephemeral: true,
      autoStopInterval: 30,
      autoDeleteInterval: 0,
      labels: {
        app: "workpowers",
        kind: "live-fork",
        sessionId
      },
      envVars: {
        NODE_ENV: "development"
      }
    });

    const repoDir = "workpowers-live-fork";

    try {
      await checkedCommand(sandbox, `git clone ${shellQuote(input.repoUrl)} ${shellQuote(repoDir)}`, undefined, 600);
      await checkedCommand(sandbox, `git checkout ${shellQuote(input.ref)}`, repoDir, 120);
      await checkedCommand(
        sandbox,
        [
          "cat > .env <<'EOF'",
          "DATABASE_URL=postgres://workpowers:workpowers@localhost:5432/workpowers_live_fork",
          "BETTER_AUTH_SECRET=dev-secret-dev-secret-dev-secret-dev-secret",
          "BETTER_AUTH_URL=http://localhost:3001",
          "EOF"
        ].join("\n"),
        repoDir,
        10
      );
      await checkedCommand(sandbox, "corepack enable && corepack prepare pnpm@10.29.1 --activate", repoDir, 180);
      await checkedCommand(sandbox, "pnpm install", repoDir, 900);
      await checkedCommand(sandbox, "bash scripts/sandbox-bootstrap-postgres.sh", repoDir, 600);
      await checkedCommand(sandbox, "pnpm db:migrate && pnpm db:seed", repoDir, 300);
      await checkedCommand(sandbox, "pnpm exec playwright install chromium", repoDir, 600);
      await checkedCommand(sandbox, "nohup pnpm dev:spike-api > /tmp/workpowers-api.log 2>&1 &", repoDir, 10);
      await checkedCommand(sandbox, "nohup pnpm dev:spike > /tmp/workpowers-vite.log 2>&1 &", repoDir, 10);
      await checkedCommand(
        sandbox,
        [
          "for i in $(seq 1 60); do",
          "  curl -fsS http://localhost:3001/health >/dev/null && curl -fsS http://localhost:3000 >/dev/null && exit 0",
          "  sleep 2",
          "done",
          "cat /tmp/workpowers-api.log /tmp/workpowers-vite.log 2>/dev/null || true",
          "exit 1"
        ].join("\n"),
        repoDir,
        130
      );
    } catch (error) {
      await sandbox.delete(120).catch(() => undefined);
      throw error;
    }

    const preview = sandbox.getSignedPreviewUrl
      ? await sandbox.getSignedPreviewUrl(3000, 60 * 60)
      : await sandbox.getPreviewLink(3000);

    const now = new Date().toISOString();
    const session: LiveForkSession = {
      id: sessionId,
      repoUrl: input.repoUrl,
      ref: input.ref,
      branchName: input.branchName,
      sandbox: {
        provider: "daytona",
        sandboxId: sandbox.id,
        status: "running"
      },
      app: {
        internalUrl: "http://localhost:3000",
        previewUrl: preview.url,
        previewToken: preview.token,
        devCommand: "pnpm dev:spike --host 0.0.0.0 --port 3000",
        healthcheckUrl: "http://localhost:3001/health"
      },
      data: {
        mode: input.data.mode ?? "local_seed",
        seedName: input.data.seedName ?? "basic-projects",
        resettable: true
      },
      lifecycle: {
        createdAt: now,
        expiresAt: sessionExpiry(120),
        idleTimeoutMinutes: 30,
        maxLifetimeMinutes: 120
      },
      artifacts: {
        logs: ["Daytona sandbox created and app boot commands were issued."]
      }
    };

    this.sandboxes.set(session.id, sandbox);
    this.workdirs.set(session.id, repoDir);
    return { session, workdir: repoDir };
  }

  async runCommand(session: LiveForkSession, command: CommandRequest) {
    const sandbox = this.requireSandbox(session);
    const result = await sandbox.process.executeCommand(
      command.command,
      command.cwd ?? this.workdirs.get(session.id),
      undefined,
      command.timeoutSeconds ?? 60
    );
    return normalizeResult(result);
  }

  async getLogs(session: LiveForkSession) {
    const result = await this.runCommand(session, {
      command: "cat /tmp/workpowers-api.log /tmp/workpowers-vite.log 2>/dev/null || true",
      timeoutSeconds: 30
    });
    return result.stdout.split("\n").filter(Boolean);
  }

  async getDiff(session: LiveForkSession) {
    const result = await this.runCommand(session, {
      command: "git diff -- . && git ls-files --others --exclude-standard | sed 's/^/?? /'",
      timeoutSeconds: 30
    });
    return result.stdout;
  }

  async stop(session: LiveForkSession) {
    const sandbox = this.requireSandbox(session);
    await sandbox.stop(60);
    await sandbox.delete(60);
  }

  private requireSandbox(session: LiveForkSession) {
    const sandbox = this.sandboxes.get(session.id);
    if (!sandbox) {
      throw new Error(`No Daytona sandbox handle is registered for ${session.id}`);
    }
    return sandbox;
  }
}
