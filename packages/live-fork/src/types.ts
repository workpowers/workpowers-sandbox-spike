export type SandboxProviderName = "daytona";

export type LiveForkSessionStatus = "starting" | "running" | "stopped" | "failed";

export type LiveForkDataMode =
  | "local_seed"
  | "curated_seed"
  | "db_branch"
  | "snapshot_restore";

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
  data: {
    mode: LiveForkDataMode;
    seedName?: string;
    resettable: boolean;
  };
  lifecycle: {
    createdAt: string;
    expiresAt: string;
    idleTimeoutMinutes: number;
    maxLifetimeMinutes: number;
  };
  artifacts: {
    gitDiff?: string;
    logs?: string[];
    screenshots?: string[];
    playwrightTrace?: string;
  };
};

export type CreateSessionRequest = {
  repoUrl: string;
  ref?: string;
  branchName?: string;
  template?: string;
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
