import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { CommandRequest, FileWriteRequest, LiveForkSession } from "../../../../packages/live-fork/src/types.js";
import {
  daemonGetDiff,
  daemonGetLogs,
  daemonReadFile,
  daemonRunCommand,
  daemonRunPlaywright,
  daemonWriteFile
} from "./daemon-client.js";
import { emptyResult, type BootEventRecorder, type NormalizedCreateSessionRequest, type ProvisionedSession, type SandboxProvider } from "./provider.js";

const execAsync = promisify(exec);

export class LocalSandboxProvider implements SandboxProvider {
  private readonly workdirs = new Map<string, string>();

  resourceProfile() {
    return {
      cpu: 0,
      memoryGb: 0,
      diskGb: 0,
      source: "local" as const
    };
  }

  async create(input: NormalizedCreateSessionRequest, session: LiveForkSession, record: BootEventRecorder): Promise<ProvisionedSession> {
    const workdir = process.env.LIVE_FORK_REPO_DIR ?? process.cwd();
    const daemonUrl = process.env.LIVE_FORK_DAEMON_URL ?? "http://localhost:8790";

    await record("creating_sandbox", "completed", "Using the local workspace as the sandbox stand-in");
    await record("starting_daemon", "running", "Checking local session daemon");

    const daemonHealth = await fetch(`${daemonUrl}/health`).catch(() => undefined);
    if (!daemonHealth?.ok) {
      await record("starting_daemon", "failed", `Local session daemon is not reachable at ${daemonUrl}`);
      throw new Error(`Local session daemon is not reachable at ${daemonUrl}`);
    }

    await record("starting_daemon", "completed", "Local session daemon is reachable");
    await record("ready", "completed", "Local live fork session is ready");

    const readySession: LiveForkSession = {
      ...session,
      repoUrl: input.repoUrl,
      ref: input.ref,
      branchName: input.branchName,
      sandbox: {
        provider: "local",
        sandboxId: `local-${session.id}`,
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
      lifecycle: session.lifecycle,
      resourceProfile: this.resourceProfile(),
      artifacts: {
        logs: [
          "Local provider claimed this workspace as the sandbox stand-in.",
          "Run `pnpm db:migrate && pnpm db:seed`, `pnpm dev:spike-api`, and `pnpm dev:spike` to serve the app locally."
        ]
      },
      internal: {
        workdir,
        daemonUrl
      }
    };

    this.workdirs.set(readySession.id, workdir);
    return { session: readySession, workdir };
  }

  async runCommand(session: LiveForkSession, command: CommandRequest) {
    if (session.internal?.daemonUrl) return daemonRunCommand(session, command);

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
    if (session.internal?.daemonUrl) return daemonGetLogs(session);
    return session.artifacts.logs ?? [];
  }

  async getDiff(session: LiveForkSession) {
    if (session.internal?.daemonUrl) return daemonGetDiff(session);
    const result = await this.runCommand(session, {
      command: "git diff -- . && git ls-files --others --exclude-standard | sed 's/^/?? /'",
      timeoutSeconds: 30
    });
    return result.stdout || result.stderr;
  }

  async runPlaywright(session: LiveForkSession) {
    if (session.internal?.playwrightCommand) {
      return daemonRunCommand(session, {
        command: session.internal.playwrightCommand,
        timeoutSeconds: 180
      });
    }
    return daemonRunPlaywright(session);
  }

  async readFile(session: LiveForkSession, path: string) {
    return daemonReadFile(session, path);
  }

  async writeFile(session: LiveForkSession, input: FileWriteRequest) {
    return daemonWriteFile(session, input);
  }

  async stop() {
    return;
  }
}
