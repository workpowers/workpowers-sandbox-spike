import type {
  FileReadResult,
  FileWriteRequest,
  LiveForkBootEventStatus,
  LiveForkBootPhase,
  CommandRequest,
  CommandResult,
  CreateSessionRequest,
  CreateTerminalRequest,
  LiveForkDataMode,
  LiveForkResourceProfile,
  LiveForkSession,
  TerminalSummary
} from "../../../../packages/live-fork/src/types.js";
import type { LiveForkProfile } from "../../../../packages/live-fork/src/profile.js";

export type NormalizedCreateSessionRequest = Omit<CreateSessionRequest, "repoUrl"> & {
  repoUrl: string;
  ref: string;
  template: string;
  data: {
    mode: LiveForkDataMode;
    seedName: string;
  };
  repoAccess?: {
    credentialRef: "org:github-app";
    cloneUrl: string;
    token: string;
    tokenExpiresAt: string;
  };
  profile?: LiveForkProfile;
  sessionEnv?: Record<string, string>;
  dataBranch?: {
    provider: "neon";
    projectId: string;
    branchId: string;
    endpointId?: string;
    databaseName: string;
    roleName: string;
  };
};

export type ProvisionedSession = {
  session: LiveForkSession;
  workdir: string;
};

export type BootEventRecorder = (
  phase: LiveForkBootPhase,
  status: LiveForkBootEventStatus,
  message: string
) => Promise<void>;

export interface SandboxProvider {
  resourceProfile(): LiveForkResourceProfile;
  create(input: NormalizedCreateSessionRequest, session: LiveForkSession, record: BootEventRecorder): Promise<ProvisionedSession>;
  runCommand(session: LiveForkSession, command: CommandRequest): Promise<CommandResult>;
  runPlaywright(session: LiveForkSession): Promise<CommandResult>;
  readFile(session: LiveForkSession, path: string): Promise<FileReadResult>;
  writeFile(session: LiveForkSession, input: FileWriteRequest): Promise<FileReadResult>;
  getLogs(session: LiveForkSession): Promise<string[]>;
  getDiff(session: LiveForkSession): Promise<string>;
  createTerminal(session: LiveForkSession, input: CreateTerminalRequest): Promise<TerminalSummary>;
  writeTerminal(session: LiveForkSession, terminalId: string, data: string): Promise<void>;
  resizeTerminal(session: LiveForkSession, terminalId: string, cols: number, rows: number): Promise<void>;
  killTerminal(session: LiveForkSession, terminalId: string): Promise<void>;
  openTerminalEventStream(session: LiveForkSession, terminalId: string, after?: number): Promise<Response>;
  stop(session: LiveForkSession): Promise<void>;
}

export function sessionExpiry(maxLifetimeMinutes: number) {
  return new Date(Date.now() + maxLifetimeMinutes * 60 * 1000).toISOString();
}

export function emptyResult(exitCode: number | null, stdout = "", stderr = ""): CommandResult {
  return { exitCode, stdout, stderr };
}

export function createStartingSession(
  input: NormalizedCreateSessionRequest,
  sessionId: string,
  provider: SandboxProvider
): LiveForkSession {
  const now = new Date().toISOString();

  const maxLifetimeMinutes = input.profile?.lifecycle.ttlMinutes ?? 120;
  const idleTimeoutMinutes = input.profile?.lifecycle.idleTimeoutMinutes ?? 30;

  return {
    id: sessionId,
    createdByUserId: input.userId,
    organizationId: input.organizationId,
    repoUrl: input.repoUrl,
    ref: input.ref,
    branchName: input.branchName,
    sandbox: {
      provider: provider.resourceProfile().source === "local" ? "local" : "daytona",
      sandboxId: "",
      status: "starting"
    },
    app: {
      internalUrl: "",
      previewUrl: "",
      devCommand: "pnpm dev:spike --host 0.0.0.0 --port 3000",
      healthcheckUrl: "http://localhost:3001/health"
    },
    boot: {
      phase: input.profile ? "loading_profile" : "creating_sandbox",
      events: [
        {
          phase: input.profile ? "loading_profile" : "creating_sandbox",
          status: "running",
          message: "Creating live fork session",
          timestamp: now
        }
      ]
    },
    data: {
      mode: input.data.mode,
      seedName: input.data.seedName,
      resettable: true
    },
    lifecycle: {
      createdAt: now,
      expiresAt: sessionExpiry(maxLifetimeMinutes),
      lastActivityAt: now,
      idleTimeoutMinutes,
      maxLifetimeMinutes
    },
    resourceProfile: provider.resourceProfile(),
    artifacts: {
      logs: []
    },
    agentRuns: []
  };
}
