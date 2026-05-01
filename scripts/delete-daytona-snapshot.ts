import "dotenv/config";
import { Daytona } from "@daytonaio/sdk";

const snapshotName = process.env.LIVE_FORK_SNAPSHOT_NAME?.trim() || "workpowers-daytona-node-playwright-postgres";

const daytona = new Daytona({
  apiKey: process.env.DAYTONA_API_KEY,
  apiUrl: process.env.DAYTONA_API_URL,
  target: process.env.DAYTONA_TARGET
});

const snapshot = await daytona.snapshot.get(snapshotName);
const snapshotPayload = snapshot as typeof snapshot & {
  items?: Array<typeof snapshot>;
  snapshot?: typeof snapshot;
};
const snapshotRecord = snapshotPayload.items?.find((item) => item.name === snapshotName) ?? snapshotPayload.snapshot ?? snapshot;

if (!snapshotRecord.name) {
  throw new Error(`Snapshot ${snapshotName} was not found in Daytona.`);
}

await daytona.snapshot.delete(snapshotRecord);
console.log(`deleted=${snapshotRecord.name}`);
