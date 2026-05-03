export type SandboxProviderName = "daytona" | "local";

export type LiveForkSessionStatus = "starting" | "running" | "stopped" | "failed";

export type AgentHarnessId = "claude-code";

export type AgentRunStatus =
  | "starting"
  | "running"
  | "stopping"
  | "completed"
  | "failed"
  | "stopped";

export type AgentRun = {
  id: string;
  sessionId: string;
  harness: AgentHarnessId;
  terminalId: string;
  status: AgentRunStatus;
  prompt: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  exitCode?: number | null;
  error?: string;
};

export type TerminalKind = "shell" | "agent";

export type CreateTerminalRequest = {
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
  kind?: TerminalKind;
};

export type TerminalEvent =
  | { seq: number; type: "output"; data: string; timestamp: string }
  | { seq: number; type: "exit"; exitCode: number | null; signal?: string; timestamp: string }
  | { seq: number; type: "error"; message: string; timestamp: string };

export type TerminalSummary = {
  id: string;
  kind: TerminalKind;
  status: "running" | "exited";
  cwd: string;
  command: string;
  pid?: number;
  exitCode?: number | null;
  createdAt: string;
};

export type LiveForkDataMode =
  | "local_seed"
  | "curated_seed"
  | "db_branch"
  | "snapshot_restore";

export type LiveForkBootPhase =
  | "loading_profile"
  | "creating_sandbox"
  | "resolving_github_access"
  | "resolving_app_environment"
  | "cloning_repo"
  | "creating_data_branch"
  | "injecting_env"
  | "installing_dependencies"
  | "starting_daemon"
  | "starting_database"
  | "running_migrations"
  | "seeding_data"
  | "starting_api"
  | "starting_frontend"
  | "starting_service"
  | "checking_health"
  | "preview_ready"
  | "cleanup"
  | "ready"
  | "failed";

export type LiveForkBootEventStatus = "running" | "completed" | "failed";

export type LiveForkBootEvent = {
  phase: LiveForkBootPhase;
  status: LiveForkBootEventStatus;
  message: string;
  timestamp: string;
  durationMs?: number;
};

export type LiveForkResourceProfile = {
  cpu: number;
  memoryGb: number;
  diskGb: number;
  source: "snapshot" | "image" | "local";
};

export type LiveForkSession = {
  id: string;
  createdByUserId?: string;
  organizationId?: string;
  repoUrl: string;
  ref: string;
  branchName?: string;
  sandbox: {
    provider: SandboxProviderName;
    sandboxId: string;
    status: LiveForkSessionStatus;
  };
  app: {
    internalUrl: string;
    previewUrl: string;
    devCommand: string;
    healthcheckUrl: string;
    previewToken?: string;
  };
  boot: {
    phase: LiveForkBootPhase;
    events: LiveForkBootEvent[];
    error?: string;
  };
  data: {
    mode: LiveForkDataMode;
    seedName?: string;
    resettable: boolean;
    provider?: "local" | "neon";
    branchId?: string;
    endpointId?: string;
    environmentRef?: string;
  };
  lifecycle: {
    createdAt: string;
    expiresAt: string;
    lastActivityAt: string;
    stoppedAt?: string;
    idleTimeoutMinutes: number;
    maxLifetimeMinutes: number;
  };
  resourceProfile: LiveForkResourceProfile;
  artifacts: {
    gitDiff?: string;
    logs?: string[];
    screenshots?: string[];
    playwrightTrace?: string;
  };
  agentRuns?: AgentRun[];
  internal?: {
    workdir?: string;
    daemonUrl?: string;
    daemonPreviewUrl?: string;
    playwrightCommand?: string;
    dataBranch?: {
      provider: "neon";
      projectId: string;
      branchId: string;
      endpointId?: string;
      databaseName: string;
      roleName: string;
    };
  };
};

export type CreateSessionRequest = {
  repoUrl?: string;
  ref?: string;
  branchName?: string;
  template?: string;
  profilePath?: string;
  organizationId?: string;
  userId?: string;
  credentialRef?: "org:github-app";
  data?: {
    mode?: LiveForkDataMode;
    seedName?: string;
  };
};

export type CommandRequest = {
  command: string;
  cwd?: string;
  timeoutSeconds?: number;
};

export type CommandResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

export type FileReadResult = {
  path: string;
  content: string;
};

export type FileWriteRequest = {
  path: string;
  content: string;
};
