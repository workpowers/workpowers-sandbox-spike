import { DaytonaSandboxProvider } from "./daytona-provider.js";
import { LocalSandboxProvider } from "./local-provider.js";
import type { SandboxProvider } from "./provider.js";

export function createProvider(): SandboxProvider {
  if (process.env.LIVE_FORK_PROVIDER === "daytona") {
    return new DaytonaSandboxProvider();
  }

  return new LocalSandboxProvider();
}
