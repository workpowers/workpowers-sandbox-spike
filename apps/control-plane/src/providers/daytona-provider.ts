import type { CreateSandboxFromImageParams, CreateSandboxFromSnapshotParams } from "@daytonaio/sdk";
import { previewService, profileToEnv } from "../../../../packages/live-fork/src/profile.js";
import { redactCommandResult, redactSecrets } from "../../../../packages/live-fork/src/redaction.js";
import type { CommandRequest, CommandResult, CreateTerminalRequest, FileWriteRequest, LiveForkBootPhase, LiveForkSession } from "../../../../packages/live-fork/src/types.js";
import {
  daemonCreateTerminal,
  daemonGetDiff,
  daemonGetLogs,
  daemonKillTerminal,
  daemonOpenTerminalEventStream,
  daemonReadFile,
  daemonResizeTerminal,
  daemonRunCommand,
  daemonRunPlaywright,
  daemonWriteTerminal,
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

function envFileCommand(env: Record<string, string>) {
  return [
    "cat > .env <<'EOF'",
    ...Object.entries(env).map(([key, value]) => `${key}=${value}`),
    "EOF"
  ].join("\n");
}

function serviceLogPath(name: string) {
  return `/tmp/workpowers-service-${name.replace(/[^a-z0-9_-]/gi, "-")}.log`;
}

function prepareWorkspaceOwnershipCommand() {
  return [
    "if id -u ubuntu >/dev/null 2>&1; then",
    "  chown -R ubuntu:ubuntu .",
    "elif id -u pwuser >/dev/null 2>&1; then",
    "  chown -R pwuser:pwuser .",
    "fi",
    "git config --global --add safe.directory \"$PWD\""
  ].join("\n");
}

function runAsWorkspaceUserCommand(command: string) {
  const quotedCommand = shellQuote(command);
  return [
    "if id -u ubuntu >/dev/null 2>&1; then",
    `  runuser -u ubuntu -- env HOME=/home/ubuntu XDG_CACHE_HOME=/tmp/workpowers-agent-cache XDG_CONFIG_HOME=/tmp/workpowers-agent-config XDG_DATA_HOME=/tmp/workpowers-agent-data sh -lc ${quotedCommand}`,
    "elif id -u pwuser >/dev/null 2>&1; then",
    `  runuser -u pwuser -- env HOME=/home/pwuser XDG_CACHE_HOME=/tmp/workpowers-agent-cache XDG_CONFIG_HOME=/tmp/workpowers-agent-config XDG_DATA_HOME=/tmp/workpowers-agent-data sh -lc ${quotedCommand}`,
    "else",
    `  sh -lc ${quotedCommand}`,
    "fi"
  ].join("\n");
}

function startServiceCommand(command: string, logPath: string) {
  return runAsWorkspaceUserCommand(`nohup ${command} > ${shellQuote(logPath)} 2>&1 &`);
}

function configuredSnapshot(input: NormalizedCreateSessionRequest) {
  return input.profile?.runtime.snapshot?.trim() || process.env.LIVE_FORK_SNAPSHOT_NAME?.trim() || "workpowers-daytona-node-playwright-postgres";
}

function configuredImage(input: NormalizedCreateSessionRequest) {
  return input.profile?.runtime.image?.trim() || process.env.LIVE_FORK_TEMPLATE_IMAGE?.trim();
}

export class DaytonaSandboxProvider implements SandboxProvider {
  private readonly sandboxes = new Map<string, DaytonaSandbox>();
  private readonly workdirs = new Map<string, string>();

  resourceProfile() {
    return {
      cpu: 2,
      memoryGb: 4,
      diskGb: 10,
      source: process.env.LIVE_FORK_ALLOW_IMAGE_FALLBACK === "true" && !process.env.LIVE_FORK_SNAPSHOT_NAME?.trim()
        ? ("image" as const)
        : ("snapshot" as const)
    };
  }

  async create(input: NormalizedCreateSessionRequest, session: LiveForkSession, record: BootEventRecorder): Promise<ProvisionedSession> {
    const { Daytona } = await import("@daytonaio/sdk");
    const daytona = new Daytona();
    const snapshot = configuredSnapshot(input);
    const image = configuredImage(input);
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

    const createParams: CreateSandboxFromSnapshotParams | CreateSandboxFromImageParams =
      snapshot && (process.env.LIVE_FORK_ALLOW_IMAGE_FALLBACK !== "true" || !image)
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
      if (input.profile) {
        const profile = input.profile;
        const env = profileToEnv(profile, input.sessionEnv ?? {});
        const envSecrets = Object.values(env);
        await record("injecting_env", "running", "Writing session-specific environment");
        await checkedCommand(sandbox, envFileCommand(env), repoDir, 10, undefined, envSecrets);
        await record("injecting_env", "completed", "Session environment written");

        const pnpm = "npx --yes pnpm@10.29.1";
        await record("installing_dependencies", "running", `Installing dependencies with ${profile.install.command}`);
        await checkedCommand(sandbox, profile.install.command, repoDir, 900, undefined, envSecrets);
        await record("installing_dependencies", "completed", "Dependencies installed");

        for (const command of profile.setup.commands) {
          const phase: LiveForkBootPhase = command.includes("sandbox-bootstrap-postgres")
            ? "starting_database"
            : command.includes("db:migrate")
              ? "running_migrations"
              : command.includes("db:seed")
                ? "seeding_data"
                : "installing_dependencies";
          await record(phase, "running", `Running setup command: ${redactSecrets(command, envSecrets)}`);
          await checkedCommand(sandbox, command, repoDir, 600, undefined, envSecrets);
          await record(phase, "completed", "Setup command completed");
        }

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
          10,
          undefined,
          envSecrets
        );
        await checkedCommand(
          sandbox,
          "for i in $(seq 1 30); do curl -fsS http://localhost:8790/health >/dev/null && exit 0; sleep 1; done; cat /tmp/workpowers-daemon.log 2>/dev/null || true; exit 1",
          repoDir,
          40,
          undefined,
          envSecrets
        );
        await record("starting_daemon", "completed", "Session daemon is healthy");
        await checkedCommand(sandbox, prepareWorkspaceOwnershipCommand(), repoDir, 120, undefined, envSecrets);

        for (const [name, service] of Object.entries(profile.services)) {
          await record("starting_service", "running", `Starting ${name}`);
          await checkedCommand(
            sandbox,
            startServiceCommand(service.command, serviceLogPath(name)),
            repoDir,
            10,
            undefined,
            envSecrets
          );
          await record("starting_service", "completed", `${name} process started`);
        }

        await record("checking_health", "running", "Checking profile service health");
        const healthCommands = Object.entries(profile.services).map(([name, service]) => {
          const logPath = serviceLogPath(name);
          return [
            `echo checking ${shellQuote(name)}`,
            `for i in $(seq 1 60); do curl -fsS ${shellQuote(service.healthcheck)} >/dev/null && exit 0; sleep 2; done`,
            `cat ${shellQuote(logPath)} 2>/dev/null || true`,
            "exit 1"
          ].join("\n");
        });
        for (const command of healthCommands) {
          await checkedCommand(sandbox, command, repoDir, 130, undefined, envSecrets);
        }
        await record("checking_health", "completed", "Profile service health checks passed");
      } else {
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
      await checkedCommand(sandbox, prepareWorkspaceOwnershipCommand(), repoDir, 120);
      await record("starting_api", "running", "Starting API server");
      await checkedCommand(sandbox, startServiceCommand(`${pnpm} dev:spike-api`, "/tmp/workpowers-api.log"), repoDir, 10);
      await record("starting_api", "completed", "API server process started");
      await record("starting_frontend", "running", "Starting Vite frontend");
      await checkedCommand(sandbox, startServiceCommand(`${pnpm} dev:spike`, "/tmp/workpowers-vite.log"), repoDir, 10);
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
      }
    } catch (error) {
      await record("failed", "failed", error instanceof Error ? error.message : String(error));
      await sandbox.delete(120).catch(() => undefined);
      throw error;
    }

    const selectedPreviewService = input.profile ? previewService(input.profile) : undefined;
    const previewPort = selectedPreviewService?.port ?? 3000;
    const preview = sandbox.getSignedPreviewUrl
      ? await sandbox.getSignedPreviewUrl(previewPort, 60 * 60)
      : await sandbox.getPreviewLink(previewPort);
    const daemonPreview = sandbox.getSignedPreviewUrl
      ? await sandbox.getSignedPreviewUrl(8790, 60 * 60)
      : await sandbox.getPreviewLink(8790);

    await record("preview_ready", "completed", `Preview is available for port ${previewPort}`);
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
        internalUrl: selectedPreviewService ? `http://localhost:${selectedPreviewService.port}` : "http://localhost:3000",
        previewUrl: preview.url,
        previewToken: preview.token,
        devCommand: selectedPreviewService?.command ?? "pnpm dev:spike --host 0.0.0.0 --port 3000",
        healthcheckUrl: selectedPreviewService?.healthcheck ?? "http://localhost:3001/health"
      },
      data: {
        mode: input.data.mode ?? "local_seed",
        seedName: input.data.seedName ?? "basic-projects",
        resettable: true,
        provider: input.profile?.data.primary.provider,
        branchId: input.dataBranch?.branchId,
        endpointId: input.dataBranch?.endpointId,
        environmentRef: input.profile?.data.primary.environmentRef
      },
      lifecycle: session.lifecycle,
      resourceProfile: this.resourceProfile(),
      artifacts: {
        logs: ["Daytona sandbox created and app boot commands were issued."]
      },
      internal: {
        workdir: repoDir,
        daemonUrl: daemonPreview.url,
        daemonPreviewUrl: daemonPreview.url,
        playwrightCommand: input.profile?.checks.playwright?.command,
        dataBranch: input.dataBranch
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

  async createTerminal(session: LiveForkSession, input: CreateTerminalRequest) {
    return daemonCreateTerminal(session, input);
  }

  async writeTerminal(session: LiveForkSession, terminalId: string, data: string) {
    return daemonWriteTerminal(session, terminalId, data);
  }

  async resizeTerminal(session: LiveForkSession, terminalId: string, cols: number, rows: number) {
    return daemonResizeTerminal(session, terminalId, cols, rows);
  }

  async killTerminal(session: LiveForkSession, terminalId: string) {
    return daemonKillTerminal(session, terminalId);
  }

  async openTerminalEventStream(session: LiveForkSession, terminalId: string, after?: number) {
    return daemonOpenTerminalEventStream(session, terminalId, after);
  }

  async stop(session: LiveForkSession) {
    const sandbox = await this.resolveSandbox(session);
    await sandbox.stop(60).catch((error: unknown) => {
      if (!isMissingSandboxError(error)) throw error;
    });
    await sandbox.delete(60).catch((error: unknown) => {
      if (!isMissingSandboxError(error)) throw error;
    });
  }

  private async resolveSandbox(session: LiveForkSession) {
    const sandbox = this.sandboxes.get(session.id);
    if (sandbox) return sandbox;
    if (!session.sandbox.sandboxId) {
      throw new Error(`No Daytona sandbox handle is registered for ${session.id}`);
    }

    const { Daytona } = await import("@daytonaio/sdk");
    const daytona = new Daytona();
    const recovered = await daytona.get(session.sandbox.sandboxId) as DaytonaSandbox;
    this.sandboxes.set(session.id, recovered);
    return recovered;
  }
}

function isMissingSandboxError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /sandbox .*not found|not found/i.test(message);
}
