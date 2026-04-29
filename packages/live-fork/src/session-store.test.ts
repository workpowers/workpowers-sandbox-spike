import { describe, expect, it } from "vitest";
import { createSessionSchema } from "./schemas.js";
import { LiveForkSessionStore } from "./session-store.js";
import type { LiveForkSession } from "./types.js";

function session(): LiveForkSession {
  return {
    id: "sess_test",
    repoUrl: "https://github.com/workpowers/live-fork-spike.git",
    ref: "main",
    sandbox: {
      provider: "daytona",
      sandboxId: "sandbox-test",
      status: "running"
    },
    app: {
      internalUrl: "http://localhost:3000",
      previewUrl: "https://preview.example",
      devCommand: "pnpm dev",
      healthcheckUrl: "http://localhost:3001/health"
    },
    data: {
      mode: "local_seed",
      seedName: "basic-projects",
      resettable: true
    },
    lifecycle: {
      createdAt: new Date(0).toISOString(),
      expiresAt: new Date(1).toISOString(),
      idleTimeoutMinutes: 30,
      maxLifetimeMinutes: 120
    },
    artifacts: {}
  };
}

describe("live fork session primitives", () => {
  it("fills session creation defaults", () => {
    const parsed = createSessionSchema.parse({
      repoUrl: "https://github.com/workpowers/live-fork-spike.git"
    });

    expect(parsed.ref).toBe("main");
    expect(parsed.template).toBe("node-pnpm-playwright-postgres");
    expect(parsed.data.mode).toBe("local_seed");
  });

  it("preserves nested session fields during partial updates", () => {
    const store = new LiveForkSessionStore();
    store.set(session());

    const updated = store.update("sess_test", {
      sandbox: {
        provider: "daytona",
        sandboxId: "sandbox-test",
        status: "stopped"
      }
    });

    expect(updated?.app.previewUrl).toBe("https://preview.example");
    expect(updated?.sandbox.status).toBe("stopped");
  });
});
