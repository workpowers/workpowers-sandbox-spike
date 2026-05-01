import "dotenv/config";
import { Daytona } from "@daytonaio/sdk";

const snapshotName = process.env.LIVE_FORK_SNAPSHOT_NAME?.trim() || "workpowers-daytona-node-playwright-postgres";
const shouldActivate = process.env.DAYTONA_ACTIVATE_SNAPSHOT === "true";

const daytona = new Daytona({
  apiKey: process.env.DAYTONA_API_KEY,
  apiUrl: process.env.DAYTONA_API_URL,
  target: process.env.DAYTONA_TARGET
});

try {
  const snapshot = await daytona.snapshot.get(snapshotName);
  const snapshotPayload = snapshot as typeof snapshot & {
    items?: Array<typeof snapshot>;
    snapshot?: typeof snapshot;
  };
  const snapshotRecord = (
    snapshotPayload.items?.find((item) => item.name === snapshotName) ??
    snapshotPayload.snapshot ??
    snapshot
  ) as typeof snapshot & {
    image_name?: string;
    memory?: number;
  };
  if (!snapshotRecord.name) {
    throw new Error(`Snapshot ${snapshotName} was not found in Daytona.`);
  }
  console.log(`snapshot=${snapshotRecord.name}`);
  console.log(`state=${snapshotRecord.state}`);
  console.log(`image=${snapshotRecord.imageName ?? snapshotRecord.image_name}`);
  console.log(`cpu=${snapshotRecord.cpu}`);
  console.log(`memoryGb=${snapshotRecord.mem ?? snapshotRecord.memory}`);
  console.log(`diskGb=${snapshotRecord.disk}`);
  if (!snapshotRecord.name || !snapshotRecord.state) console.log(`raw=${JSON.stringify(snapshot)}`);
  if (snapshotRecord.errorReason) console.log(`error=${snapshotRecord.errorReason}`);

  if (snapshotRecord.state === "inactive" && shouldActivate) {
    const activated = await daytona.snapshot.activate(snapshotRecord);
    console.log(`activated_state=${activated.state}`);
  } else if (snapshotRecord.state !== "active") {
    console.log("hint=Create or activate this snapshot before starting Daytona live fork sessions.");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error("hint=Run `pnpm daytona:snapshot` after confirming the Daytona API key can create snapshots.");
  process.exit(1);
}
