import "dotenv/config";
import { Daytona } from "@daytonaio/sdk";
import { nanoid } from "nanoid";
import { resolveGitHubRepoAccess } from "../apps/spike-app/server/github-app.js";
import { redactSecrets } from "../packages/live-fork/src/redaction.js";

const organizationId = process.env.LIVE_FORK_TEST_ORG_ID ?? "4fe2301e-16ce-4c21-9346-f18f410d4c38";
const repo = process.env.LIVE_FORK_TEST_REPO ?? "evanfuture/ringofbeara.com";
const snapshot = process.env.LIVE_FORK_SNAPSHOT_NAME?.trim() || "workpowers-daytona-node-playwright-postgres";

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function cloneCommand(repoUrl: string, repoDir: string) {
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

type SmokeCommandResult = {
  exitCode?: number;
  result?: string;
  stdout?: string;
  stderr?: string;
};

async function checked(commandResult: SmokeCommandResult, token: string) {
  const exitCode = commandResult.exitCode ?? 0;
  if (exitCode !== 0) {
    throw new Error(redactSecrets(commandResult.stderr ?? commandResult.result ?? commandResult.stdout ?? "", [token]));
  }
  return commandResult;
}

const repoAccess = await resolveGitHubRepoAccess({ organizationId, repo });
const daytona = new Daytona();
const sandbox = await daytona.create({
  name: `workpowers-clone-smoke-${nanoid(8)}`,
  snapshot,
  public: false,
  ephemeral: true,
  autoStopInterval: 5,
  autoDeleteInterval: 0,
  labels: {
    app: "workpowers",
    kind: "private-clone-smoke"
  }
});

try {
  await checked(
    await sandbox.process.executeCommand(
      cloneCommand(repoAccess.cloneUrl, "repo"),
      undefined,
      { GITHUB_APP_INSTALLATION_TOKEN: repoAccess.token },
      600
    ),
    repoAccess.token
  );
  await checked(await sandbox.process.executeCommand(`git remote set-url origin ${shellQuote(repoAccess.cloneUrl)}`, "repo", undefined, 30), repoAccess.token);
  const packageJson = await checked(await sandbox.process.executeCommand("test -f package.json && git remote get-url origin", "repo", undefined, 30), repoAccess.token);
  console.log(`sandbox=${sandbox.id}`);
  console.log(`repo=${repoAccess.fullName}`);
  console.log(`origin=${String(packageJson.stdout ?? packageJson.result ?? "").trim()}`);
  console.log("private_clone=ok");
} finally {
  await sandbox.delete(120).catch(() => undefined);
}
