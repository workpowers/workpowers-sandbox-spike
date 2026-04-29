import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { CommandRequest, LiveForkSession } from "../../../../packages/live-fork/src/types.js";
import { emptyResult, sessionExpiry, type NormalizedCreateSessionRequest, type ProvisionedSession, type SandboxProvider } from "./provider.js";

const execAsync = promisify(exec);

export class LocalSandboxProvider implements SandboxProvider {
  private readonly workdirs = new Map<string, string>();

  async create(input: NormalizedCreateSessionRequest, sessionId: string): Promise<ProvisionedSession> {
    const now = new Date().toISOString();
    const workdir = process.env.LIVE_FORK_REPO_DIR ?? process.cwd();
    const session: LiveForkSession = {
      id: sessionId,
      repoUrl: input.repoUrl,
      ref: input.ref,
      branchName: input.branchName,
      sandbox: {
        provider: "daytona",
        sandboxId: `local-${sessionId}`,
        status: "running"
      },
      app: {
        internalUrl: "http://localhost:3000",
        previewUrl: "http://localhost:3000",
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
        logs: [
          "Local provider claimed this workspace as the sandbox stand-in.",
          "Run `pnpm db:migrate && pnpm db:seed`, `pnpm dev:spike-api`, and `pnpm dev:spike` to serve the app locally."
        ]
      }
    };

    this.workdirs.set(session.id, workdir);
    return { session, workdir };
  }

  async runCommand(session: LiveForkSession, command: CommandRequest) {
    const cwd = command.cwd ?? this.workdirs.get(session.id) ?? process.cwd();

    try {
      const { stdout, stderr } = await execAsync(command.command, {
        cwd,
        timeout: (command.timeoutSeconds ?? 60) * 1000,
        maxBuffer: 10 * 1024 * 1024,
        shell: process.env.SHELL ?? "/bin/sh"
      });
      return emptyResult(0, stdout, stderr);
    } catch (error) {
      const failure = error as { code?: number; stdout?: string; stderr?: string; message?: string };
      return emptyResult(failure.code ?? 1, failure.stdout ?? "", failure.stderr ?? failure.message ?? "");
    }
  }

  async getLogs(session: LiveForkSession) {
    return session.artifacts.logs ?? [];
  }

  async getDiff(session: LiveForkSession) {
    const result = await this.runCommand(session, {
      command: "git diff -- . && git ls-files --others --exclude-standard | sed 's/^/?? /'",
      timeoutSeconds: 30
    });
    return result.stdout || result.stderr;
  }

  async stop() {
    return;
  }
}
