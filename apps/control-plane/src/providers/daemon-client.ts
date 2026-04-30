import { redactCommandResult, redactSecrets } from "../../../../packages/live-fork/src/redaction.js";
import type { CommandRequest, CommandResult, FileReadResult, FileWriteRequest, LiveForkSession } from "../../../../packages/live-fork/src/types.js";

function requireDaemonUrl(session: LiveForkSession) {
  const daemonUrl = session.internal?.daemonUrl;
  if (!daemonUrl) throw new Error(`No session daemon URL is registered for ${session.id}`);
  return daemonUrl.replace(/\/$/, "");
}

async function parseCommandResponse(response: Response): Promise<CommandResult> {
  const json = (await response.json()) as CommandResult;
  return {
    exitCode: json.exitCode ?? null,
    stdout: json.stdout ?? "",
    stderr: json.stderr ?? ""
  };
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = redactSecrets(await response.text());
    throw new Error(`Daemon request failed (${response.status}): ${body}`);
  }
  return (await response.json()) as T;
}

export async function daemonRunCommand(session: LiveForkSession, command: CommandRequest) {
  const response = await fetch(`${requireDaemonUrl(session)}/run-command`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(command)
  });
  if (!response.ok) throw new Error(`Daemon command failed (${response.status}): ${redactSecrets(await response.text())}`);
  return redactCommandResult(await parseCommandResponse(response));
}

export async function daemonRunPlaywright(session: LiveForkSession) {
  const response = await fetch(`${requireDaemonUrl(session)}/run-playwright`, {
    method: "POST"
  });
  if (!response.ok) throw new Error(`Daemon Playwright request failed (${response.status}): ${redactSecrets(await response.text())}`);
  return redactCommandResult(await parseCommandResponse(response));
}

export async function daemonGetLogs(session: LiveForkSession) {
  const json = await requestJson<{ logs: string[] }>(`${requireDaemonUrl(session)}/logs`);
  return json.logs.map((log) => redactSecrets(log));
}

export async function daemonGetDiff(session: LiveForkSession) {
  const response = await fetch(`${requireDaemonUrl(session)}/git-diff`);
  if (!response.ok) throw new Error(`Daemon diff request failed (${response.status}): ${redactSecrets(await response.text())}`);
  return redactSecrets(await response.text());
}

export async function daemonReadFile(session: LiveForkSession, filePath: string): Promise<FileReadResult> {
  const response = await fetch(`${requireDaemonUrl(session)}/read-file?path=${encodeURIComponent(filePath)}`);
  if (!response.ok) throw new Error(`Daemon read-file request failed (${response.status}): ${redactSecrets(await response.text())}`);
  return {
    path: filePath,
    content: await response.text()
  };
}

export async function daemonWriteFile(session: LiveForkSession, input: FileWriteRequest): Promise<FileReadResult> {
  await requestJson<{ ok: boolean; path: string }>(`${requireDaemonUrl(session)}/write-file`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  return daemonReadFile(session, input.path);
}
