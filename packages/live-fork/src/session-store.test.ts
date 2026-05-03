import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createSessionSchema } from "./schemas.js";
import { LiveForkSessionStore, redactSession } from "./session-store.js";
import type { LiveForkSession } from "./types.js";

function session(overrides: Partial<LiveForkSession> = {}): LiveForkSession {
  const now = new Date(0).toISOString();

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
      previewToken: "secret-token",
      devCommand: "pnpm dev",
      healthcheckUrl: "http://localhost:3001/health"
    },
    boot: {
      phase: "ready",
      events: []
    },
    data: {
      mode: "local_seed",
      seedName: "basic-projects",
      resettable: true
    },
    lifecycle: {
      createdAt: now,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      lastActivityAt: now,
      idleTimeoutMinutes: 30,
      maxLifetimeMinutes: 120
    },
    resourceProfile: {
      cpu: 2,
      memoryGb: 4,
      diskGb: 10,
      source: "image"
    },
    artifacts: {},
    internal: {
      daemonUrl: "https://daemon.example",
      workdir: "workpowers-live-fork"
    },
    ...overrides
  };
}

async function storePath() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "workpowers-sessions-"));
  return path.join(dir, "sessions.json");
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

  it("preserves nested session fields during partial updates", async () => {
    const store = new LiveForkSessionStore({ persist: false });
    await store.set(session());

    const updated = await store.update("sess_test", {
      sandbox: {
        status: "stopped"
      }
    });

    expect(updated?.app.previewUrl).toBe("https://preview.example");
    expect(updated?.sandbox.status).toBe("stopped");
    expect(updated?.sandbox.sandboxId).toBe("sandbox-test");
  });

  it("persists and reloads sessions from an atomic JSON file", async () => {
    const filePath = await storePath();
    const writer = new LiveForkSessionStore({ filePath });
    await writer.set(session());

    const raw = await readFile(filePath, "utf8");
    expect(JSON.parse(raw).sessions).toHaveLength(1);

    const reader = new LiveForkSessionStore({ filePath });
    await reader.load();
    expect(reader.get("sess_test")?.repoUrl).toContain("github.com");
  });

  it("serializes concurrent persisted updates", async () => {
    const filePath = await storePath();
    const writer = new LiveForkSessionStore({ filePath });
    await writer.set(session());

    await Promise.all([
      writer.touch("sess_test", new Date(1).toISOString()),
      writer.appendBootEvent("sess_test", {
        phase: "ready",
        status: "completed",
        message: "First concurrent event"
      }),
      writer.appendBootEvent("sess_test", {
        phase: "ready",
        status: "completed",
        message: "Second concurrent event"
      })
    ]);

    const raw = await readFile(filePath, "utf8");
    expect(JSON.parse(raw).sessions).toHaveLength(1);

    const reader = new LiveForkSessionStore({ filePath });
    await reader.load();
    expect(reader.get("sess_test")?.boot.events).toHaveLength(2);
  });

  it("redacts token-shaped values before persisting sessions", async () => {
    const token = "ghs_abcdefghijklmnopqrstuvwxyz1234567890";
    const filePath = await storePath();
    const writer = new LiveForkSessionStore({ filePath });

    await writer.set(
      session({
        repoUrl: `https://x-access-token:${token}@github.com/workpowers/live-fork-spike.git`,
        boot: {
          phase: "failed",
          error: `clone failed for ${token}`,
          events: [
            {
              phase: "cloning_repo",
              status: "failed",
              message: `fatal: ${token}`,
              timestamp: new Date(0).toISOString()
            }
          ]
        },
        artifacts: {
          logs: [`Authorization: Bearer ${token}`]
        }
      })
    );

    const raw = await readFile(filePath, "utf8");
    expect(raw).not.toContain(token);
    expect(raw).toContain("[REDACTED]");
  });

  it("persists agent runs with harness secrets redacted", async () => {
    const secret = "sk-ant-api03-test-secret-value";
    const previous = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = secret;
    const filePath = await storePath();
    const writer = new LiveForkSessionStore({ filePath });
    try {
      await writer.set(session());

      await writer.appendAgentRun("sess_test", {
        id: "arun_test",
        sessionId: "sess_test",
        harness: "claude-code",
        terminalId: "term_test",
        status: "running",
        prompt: `Use ${secret} nowhere.`,
        createdAt: new Date(0).toISOString(),
        startedAt: new Date(0).toISOString(),
        error: `Failed with ${secret}`
      });

      const raw = await readFile(filePath, "utf8");
      expect(raw).not.toContain(secret);
      expect(raw).toContain("[REDACTED]");
    } finally {
      if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previous;
    }
  });

  it("records boot events in order and updates the active phase", async () => {
    const store = new LiveForkSessionStore({ persist: false });
    await store.set(session({ boot: { phase: "creating_sandbox", events: [] } }));

    await store.recordBootPhase("sess_test", "cloning_repo", "running", "Cloning");
    await store.recordBootPhase("sess_test", "ready", "completed", "Ready");

    const updated = store.get("sess_test");
    expect(updated?.boot.phase).toBe("ready");
    expect(updated?.sandbox.status).toBe("running");
    expect(updated?.boot.events.map((event) => event.phase)).toEqual(["cloning_repo", "ready"]);
  });

  it("marks active sessions failed on startup reconciliation", async () => {
    const store = new LiveForkSessionStore({ persist: false });
    await store.set(session({ sandbox: { provider: "daytona", sandboxId: "sandbox-test", status: "starting" } }));

    await store.reconcileActiveSessions(new Date(1).toISOString());

    const reconciled = store.get("sess_test");
    expect(reconciled?.sandbox.status).toBe("failed");
    expect(reconciled?.boot.phase).toBe("failed");
    expect(reconciled?.boot.events.at(-1)?.message).toContain("lost the sandbox handle");
  });

  it("finds expired sessions that still need cleanup", async () => {
    const store = new LiveForkSessionStore({ persist: false });
    await store.set(
      session({
        lifecycle: {
          createdAt: new Date(0).toISOString(),
          expiresAt: new Date(1).toISOString(),
          lastActivityAt: new Date(0).toISOString(),
          idleTimeoutMinutes: 30,
          maxLifetimeMinutes: 120
        }
      })
    );

    expect(store.expiredSessions(new Date(2))).toHaveLength(1);
  });

  it("redacts internal control details from public session payloads", () => {
    const redacted = redactSession(session());

    expect(redacted.app).not.toHaveProperty("previewToken");
    expect(redacted).not.toHaveProperty("internal");
  });
});
