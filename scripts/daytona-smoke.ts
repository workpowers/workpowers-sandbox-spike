import "dotenv/config";
import { Daytona } from "@daytonaio/sdk";

const daytona = new Daytona({
  apiKey: process.env.DAYTONA_API_KEY,
  apiUrl: process.env.DAYTONA_API_URL,
  target: process.env.DAYTONA_TARGET
});

const sandbox = await daytona.create(
  {
    name: `workpowers-smoke-${Date.now()}`,
    language: "typescript",
    public: true,
    ephemeral: true,
    autoStopInterval: 15,
    labels: {
      app: "workpowers",
      kind: "smoke"
    }
  },
  { timeout: 180 }
);

console.log(`sandbox=${sandbox.id}`);

try {
  for (const command of [
    "pwd",
    "node --version || true",
    "npm --version || true",
    "pnpm --version || true",
    "git --version || true",
    "which docker || true",
    "which initdb || true",
    "which pg_ctl || true",
    "which psql || true"
  ]) {
    const result = await sandbox.process.executeCommand(command, undefined, undefined, 60);
    console.log(`\n$ ${command}`);
    console.log(result.result ?? result.artifacts?.stdout ?? "");
  }
} finally {
  console.log(`\ndeleting=${sandbox.id}`);
  await sandbox.delete(120);
}
