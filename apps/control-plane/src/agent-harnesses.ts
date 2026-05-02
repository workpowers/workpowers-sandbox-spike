import type { AgentHarnessId, AgentRun } from "../../../packages/live-fork/src/types.js";

type AgentHarnessAdapter = {
  id: AgentHarnessId;
  label: string;
  command: string;
  argsForPrompt(prompt: string, run: AgentRun): string[];
  envForRun(run: AgentRun): Record<string, string>;
};

export function resolveAgentHarness(id: AgentHarnessId): AgentHarnessAdapter {
  if (id !== "claude-code") throw new Error(`Unsupported agent harness: ${id}`);
  return claudeCodeAdapter;
}

const claudeCodeAdapter: AgentHarnessAdapter = {
  id: "claude-code",
  label: "Claude Code",
  command: process.env.CLAUDE_CODE_COMMAND?.trim() || "claude",
  argsForPrompt(prompt) {
    return [
      "--bare",
      "--permission-mode",
      "bypassPermissions",
      "-p",
      prompt,
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages"
    ];
  },
  envForRun(run) {
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_API_KEY;
    if (!anthropicApiKey) {
      throw new Error("ANTHROPIC_API_KEY or CLAUDE_CODE_API_KEY is required to start Claude Code agent runs.");
    }

    return {
      ANTHROPIC_API_KEY: anthropicApiKey,
      CLAUDE_CODE_ENTRYPOINT: "workpowers",
      HOME: process.env.WORKPOWERS_AGENT_HOME ?? "/home/ubuntu",
      XDG_CACHE_HOME: "/tmp/workpowers-agent-cache",
      XDG_CONFIG_HOME: "/tmp/workpowers-agent-config",
      XDG_DATA_HOME: "/tmp/workpowers-agent-data",
      WORKPOWERS_AGENT_RUN_ID: run.id,
      WORKPOWERS_AGENT_PROMPT: run.prompt
    };
  }
};
