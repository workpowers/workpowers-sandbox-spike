import type { CreateSandboxFromImageParams, CreateSandboxFromSnapshotParams } from "@daytonaio/sdk";
import { redactCommandResult, redactSecrets } from "../../../../packages/live-fork/src/redaction.js";
import type { CommandRequest, CommandResult, FileWriteRequest, LiveForkSession } from "../../../../packages/live-fork/src/types.js";
import {
  daemonGetDiff,
  daemonGetLogs,
  daemonReadFile,
  daemonRunCommand,
  daemonRunPlaywright,
  daemonWriteFile
} from "./daemon-client.js";
import { emptyResult, type BootEventRecorder, type NormalizedCreateSessionRequest, type ProvisionedSession, type SandboxProvider } from "./provider.js";

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

function normalizeResult(
  result: Awaited<ReturnType<DaytonaSandbox["process"]["executeCommand"]>>,
  secrets: string[] = []
): CommandResult {
  return redactCommandResult(
    emptyResult(
    result.exitCode ?? 0,
    result.stdout ?? result.result ?? result.artifacts?.stdout ?? "",
    result.stderr ?? ""
    ),
    secrets
  );
}

async function checkedCommand(
  sandbox: DaytonaSandbox,
  command: string,
  cwd?: string,
  timeoutSeconds = 60,
  env?: Record<string, string>,
  secrets: string[] = []
) {
  const result = normalizeResult(await sandbox.process.executeCommand(command, cwd, env, timeoutSeconds), secrets);
  if (result.exitCode !== 0) {
    throw new Error(
      [
        `Daytona setup command failed with exit code ${result.exitCode}`,
        `$ ${redactSecrets(command, secrets)}`,
        result.stdout,
        result.stderr
      ]
        .filter(Boolean)
        .join("\n")
    );
  }
  return result;
}

function cloneCommand(repoUrl: string, repoDir: string, token?: string) {
  if (!token) return `git clone ${shellQuote(repoUrl)} ${shellQuote(repoDir)}`;

  return [
    "set -e",
    "askpass=$(mktemp)",
    "cat > \"$askpass\" <<'EOF'",
    "#!/bin/sh",
    "case \"$1\" in",
    "*Username*) echo x-access-token ;;",
    "*Password*) printf '%s\\n' \"$GITHUB_APP_INSTALLATION_TOKEN\" ;;",
    "*) echo ;;",
    "esac",
    "EOF",
    "chmod 700 \"$askpass\"",
    `GIT_TERMINAL_PROMPT=0 GIT_ASKPASS="$askpass" git clone ${shellQuote(repoUrl)} ${shellQuote(repoDir)}`,
    "rm -f \"$askpass\""
  ].join("\n");
}

export class DaytonaSandboxProvider implements SandboxProvider {
  private readonly sandboxes = new Map<string, DaytonaSandbox>();
  private readonly workdirs = new Map<string, string>();

  resourceProfile() {
    return {
      cpu: 2,
      memoryGb: 4,
      diskGb: 10,
      source: process.env.LIVE_FORK_SNAPSHOT_NAME ? ("snapshot" as const) : ("image" as const)
    };
  }

  async create(input: NormalizedCreateSessionRequest, session: LiveForkSession, record: BootEventRecorder): Promise<ProvisionedSession> {
    const { Daytona } = await import("@daytonaio/sdk");
    const daytona = new Daytona();
    const snapshot = process.env.LIVE_FORK_SNAPSHOT_NAME;
    const image = process.env.LIVE_FORK_TEMPLATE_IMAGE;
    const baseCreateParams = {
      name: `workpowers-${session.id}`,
      public: true,
      ephemeral: true,
      autoStopInterval: 30,
      autoDeleteInterval: 0,
      labels: {
        app: "workpowers",
        kind: "live-fork",
        sessionId: session.id
      },
      envVars: {
        NODE_ENV: "development"
      }
    };

    const createParams: CreateSandboxFromSnapshotParams | CreateSandboxFromImageParams = snapshot
      ? { ...baseCreateParams, snapshot }
      : image
        ? {
          ...baseCreateParams,
          image,
          resources: {
            cpu: 2,
            memory: 4,
            disk: 10
          }
        }
        : { ...baseCreateParams, language: "typescript" };

    const sandbox: DaytonaSandbox = await daytona.create(createParams);
    session.sandbox.provider = "daytona";
    session.sandbox.sandboxId = sandbox.id;

    const repoDir = "workpowers-live-fork";

    try {
      await record("creating_sandbox", "completed", `Daytona sandbox ${sandbox.id} created`);
      await record("cloning_repo", "running", "Cloning repository into the sandbox");
      const cloneUrl = input.repoAccess?.cloneUrl ?? input.repoUrl;
      const cloneSecrets = input.repoAccess?.token ? [input.repoAccess.token] : [];
      await checkedCommand(
        sandbox,
        cloneCommand(cloneUrl, repoDir, input.repoAccess?.token),
        undefined,
        600,
        input.repoAccess?.token ? { GITHUB_APP_INSTALLATION_TOKEN: input.repoAccess.token } : undefined,
        cloneSecrets
      );
      await checkedCommand(sandbox, `git remote set-url origin ${shellQuote(cloneUrl)}`, repoDir, 30, undefined, cloneSecrets);
      await record("cloning_repo", "completed", "Repository cloned");
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
      const pnpm = "npx --yes pnpm@10.29.1";
      await record("installing_dependencies", "running", "Installing dependencies");
      await checkedCommand(sandbox, `${pnpm} install`, repoDir, 900);
      await record("installing_dependencies", "completed", "Dependencies installed");
      await record("starting_daemon", "running", "Starting session daemon");
      await checkedCommand(
        sandbox,
        [
          "if [ -f /opt/workpowers-session-daemon/package.json ]; then",
          "  nohup env LIVE_FORK_WORKDIR=$PWD SESSION_DAEMON_PORT=8790 pnpm --dir /opt/workpowers-session-daemon dev:daemon > /tmp/workpowers-daemon.log 2>&1 &",
          "else",
          `  nohup env LIVE_FORK_WORKDIR=$PWD SESSION_DAEMON_PORT=8790 ${pnpm} dev:daemon > /tmp/workpowers-daemon.log 2>&1 &`,
          "fi"
        ].join("\n"),
        repoDir,
        10
      );
      await checkedCommand(
        sandbox,
        "for i in $(seq 1 30); do curl -fsS http://localhost:8790/health >/dev/null && exit 0; sleep 1; done; cat /tmp/workpowers-daemon.log 2>/dev/null || true; exit 1",
        repoDir,
        40
      );
      await record("starting_daemon", "completed", "Session daemon is healthy");
      await record("starting_database", "running", "Starting sandbox-local Postgres");
      await checkedCommand(sandbox, "bash scripts/sandbox-bootstrap-postgres.sh", repoDir, 600);
      await record("starting_database", "completed", "Postgres is ready");
      await record("running_migrations", "running", "Running database migrations");
      await checkedCommand(sandbox, `${pnpm} db:migrate`, repoDir, 300);
      await record("running_migrations", "completed", "Database migrations complete");
      await record("seeding_data", "running", "Seeding sandbox data");
      await checkedCommand(sandbox, `${pnpm} db:seed`, repoDir, 300);
      await record("seeding_data", "completed", "Sandbox data seeded");
      await checkedCommand(sandbox, `${pnpm} exec playwright install chromium`, repoDir, 600);
      await record("starting_api", "running", "Starting API server");
      await checkedCommand(sandbox, `nohup ${pnpm} dev:spike-api > /tmp/workpowers-api.log 2>&1 &`, repoDir, 10);
      await record("starting_api", "completed", "API server process started");
      await record("starting_frontend", "running", "Starting Vite frontend");
      await checkedCommand(sandbox, `nohup ${pnpm} dev:spike > /tmp/workpowers-vite.log 2>&1 &`, repoDir, 10);
      await record("starting_frontend", "completed", "Frontend process started");
      await record("checking_health", "running", "Checking API and preview health");
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
      await record("checking_health", "completed", "API and frontend health checks passed");
    } catch (error) {
      await record("failed", "failed", error instanceof Error ? error.message : String(error));
      await sandbox.delete(120).catch(() => undefined);
      throw error;
    }

    const preview = sandbox.getSignedPreviewUrl
      ? await sandbox.getSignedPreviewUrl(3000, 60 * 60)
      : await sandbox.getPreviewLink(3000);
    const daemonPreview = sandbox.getSignedPreviewUrl
      ? await sandbox.getSignedPreviewUrl(8790, 60 * 60)
      : await sandbox.getPreviewLink(8790);

    await record("ready", "completed", "Live fork session is ready");

    const readySession: LiveForkSession = {
      ...session,
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
      lifecycle: session.lifecycle,
      resourceProfile: this.resourceProfile(),
      artifacts: {
        logs: ["Daytona sandbox created and app boot commands were issued."]
      },
      internal: {
        workdir: repoDir,
        daemonUrl: daemonPreview.url,
        daemonPreviewUrl: daemonPreview.url
      }
    };

    this.sandboxes.set(readySession.id, sandbox);
    this.workdirs.set(readySession.id, repoDir);
    return { session: readySession, workdir: repoDir };
  }

  async runCommand(session: LiveForkSession, command: CommandRequest) {
    return daemonRunCommand(session, command);
  }

  async getLogs(session: LiveForkSession) {
    return daemonGetLogs(session);
  }

  async getDiff(session: LiveForkSession) {
    return daemonGetDiff(session);
  }

  async runPlaywright(session: LiveForkSession) {
    return daemonRunPlaywright(session);
  }

  async readFile(session: LiveForkSession, path: string) {
    return daemonReadFile(session, path);
  }

  async writeFile(session: LiveForkSession, input: FileWriteRequest) {
    return daemonWriteFile(session, input);
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
