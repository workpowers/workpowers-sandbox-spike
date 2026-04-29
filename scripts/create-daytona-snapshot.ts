import "dotenv/config";
import { Daytona, Image } from "@daytonaio/sdk";

const snapshotName = process.env.LIVE_FORK_SNAPSHOT_NAME ?? "workpowers-daytona-node-playwright-postgres";
const image = Image.base("mcr.microsoft.com/playwright:v1.59.1-noble")
  .env({
    DEBIAN_FRONTEND: "noninteractive",
    PNPM_HOME: "/usr/local/share/pnpm",
    PATH: "/usr/local/share/pnpm:$PATH"
  })
  .runCommands(
    [
      "apt-get update",
      "apt-get install -y --no-install-recommends ca-certificates curl git postgresql postgresql-client",
      "npm install -g pnpm@10.29.1",
      "pnpm --version",
      "rm -rf /var/lib/apt/lists/*"
    ].join(" && ")
  )
  .workdir("/opt/workpowers-session-daemon")
  .addLocalFile("package.json", "/opt/workpowers-session-daemon/package.json")
  .addLocalFile("pnpm-lock.yaml", "/opt/workpowers-session-daemon/pnpm-lock.yaml")
  .addLocalFile("pnpm-workspace.yaml", "/opt/workpowers-session-daemon/pnpm-workspace.yaml")
  .addLocalFile("tsconfig.json", "/opt/workpowers-session-daemon/tsconfig.json")
  .addLocalDir("packages", "/opt/workpowers-session-daemon/packages")
  .addLocalDir("apps/session-daemon", "/opt/workpowers-session-daemon/apps/session-daemon")
  .runCommands("pnpm install --frozen-lockfile --prefer-offline")
  .workdir("/workspace");

const daytona = new Daytona({
  apiKey: process.env.DAYTONA_API_KEY,
  apiUrl: process.env.DAYTONA_API_URL,
  target: process.env.DAYTONA_TARGET
});

const snapshot = await daytona.snapshot.create(
  {
    name: snapshotName,
    image,
    resources: {
      cpu: 2,
      memory: 4,
      disk: 10
    }
  },
  {
    onLogs: (line) => console.log(line)
  }
);

console.log(`snapshot=${snapshot.name}`);
console.log(`state=${snapshot.state}`);
