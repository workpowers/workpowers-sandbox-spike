import type {
  CommandRequest,
  CommandResult,
  CreateSessionRequest,
  LiveForkDataMode,
  LiveForkSession
} from "../../../../packages/live-fork/src/types.js";

export type NormalizedCreateSessionRequest = CreateSessionRequest & {
  ref: string;
  template: string;
  data: {
    mode: LiveForkDataMode;
    seedName: string;
  };
};

export type ProvisionedSession = {
  session: LiveForkSession;
  workdir: string;
};

export interface SandboxProvider {
  create(input: NormalizedCreateSessionRequest, sessionId: string): Promise<ProvisionedSession>;
  runCommand(session: LiveForkSession, command: CommandRequest): Promise<CommandResult>;
  getLogs(session: LiveForkSession): Promise<string[]>;
  getDiff(session: LiveForkSession): Promise<string>;
  stop(session: LiveForkSession): Promise<void>;
}

export function sessionExpiry(maxLifetimeMinutes: number) {
  return new Date(Date.now() + maxLifetimeMinutes * 60 * 1000).toISOString();
}

export function emptyResult(exitCode: number | null, stdout = "", stderr = ""): CommandResult {
  return { exitCode, stdout, stderr };
}
