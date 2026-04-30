export type SandboxProviderName = "daytona" | "local";

export type LiveForkSessionStatus = "starting" | "running" | "stopped" | "failed";

export type LiveForkDataMode =
  | "local_seed"
  | "curated_seed"
  | "db_branch"
  | "snapshot_restore";

export type LiveForkBootPhase =
  | "creating_sandbox"
  | "cloning_repo"
  | "installing_dependencies"
  | "starting_daemon"
  | "starting_database"
  | "running_migrations"
  | "seeding_data"
  | "starting_api"
  | "starting_frontend"
  | "checking_health"
  | "ready"
  | "failed";

export type LiveForkBootEventStatus = "running" | "completed" | "failed";

export type LiveForkBootEvent = {
  phase: LiveForkBootPhase;
  status: LiveForkBootEventStatus;
  message: string;
  timestamp: string;
};

export type LiveForkResourceProfile = {
  cpu: number;
  memoryGb: number;
  diskGb: number;
  source: "snapshot" | "image" | "local";
};

export type LiveForkSession = {
  id: string;
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
  internal?: {
    workdir?: string;
    daemonUrl?: string;
    daemonPreviewUrl?: string;
  };
};

export type CreateSessionRequest = {
  repoUrl: string;
  ref?: string;
  branchName?: string;
  template?: string;
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
