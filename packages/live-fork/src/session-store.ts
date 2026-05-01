import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type {
  LiveForkBootEvent,
  LiveForkBootEventStatus,
  LiveForkBootPhase,
  LiveForkSession
} from "./types.js";
import { redactSecrets } from "./redaction.js";

type LiveForkSessionPatch = Partial<
  Omit<LiveForkSession, "sandbox" | "app" | "boot" | "data" | "lifecycle" | "resourceProfile" | "artifacts" | "internal">
> & {
  sandbox?: Partial<LiveForkSession["sandbox"]>;
  app?: Partial<LiveForkSession["app"]>;
  boot?: Partial<LiveForkSession["boot"]>;
  data?: Partial<LiveForkSession["data"]>;
  lifecycle?: Partial<LiveForkSession["lifecycle"]>;
  resourceProfile?: Partial<LiveForkSession["resourceProfile"]>;
  artifacts?: Partial<LiveForkSession["artifacts"]>;
  internal?: Partial<NonNullable<LiveForkSession["internal"]>>;
};

type SessionStoreFile = {
  sessions: LiveForkSession[];
};

export type RedactedLiveForkSession = Omit<LiveForkSession, "internal"> & {
  app: Omit<LiveForkSession["app"], "previewToken">;
};

export class LiveForkSessionStore {
  private readonly sessions = new Map<string, LiveForkSession>();
  private readonly filePath: string;
  private readonly persist: boolean;
  private saveQueue = Promise.resolve();

  constructor(options: { filePath?: string; persist?: boolean } = {}) {
    this.filePath = options.filePath ?? path.resolve(".workpowers/sessions.json");
    this.persist = options.persist ?? true;
  }

  async load() {
    if (!this.persist) return;

    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as SessionStoreFile | LiveForkSession[];
      const sessions = Array.isArray(parsed) ? parsed : parsed.sessions;
      this.sessions.clear();
      for (const session of sessions ?? []) this.sessions.set(session.id, session);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  list() {
    return [...this.sessions.values()];
  }

  listPublic() {
    return this.list().map(redactSession);
  }

  get(id: string) {
    return this.sessions.get(id);
  }

  getPublic(id: string) {
    const session = this.get(id);
    return session ? redactSession(session) : undefined;
  }

  async set(session: LiveForkSession) {
    this.sessions.set(session.id, session);
    await this.save();
    return session;
  }

  async touch(id: string, now = new Date().toISOString()) {
    return this.update(id, { lifecycle: { lastActivityAt: now } });
  }

  async update(id: string, patch: LiveForkSessionPatch) {
    const current = this.sessions.get(id);
    if (!current) return undefined;

    const next: LiveForkSession = {
      ...current,
      ...patch,
      sandbox: { ...current.sandbox, ...patch.sandbox },
      app: { ...current.app, ...patch.app },
      boot: { ...current.boot, ...patch.boot },
      data: { ...current.data, ...patch.data },
      lifecycle: { ...current.lifecycle, ...patch.lifecycle },
      resourceProfile: { ...current.resourceProfile, ...patch.resourceProfile },
      artifacts: { ...current.artifacts, ...patch.artifacts },
      internal: patch.internal ? { ...(current.internal ?? {}), ...patch.internal } : current.internal
    };

    this.sessions.set(id, next);
    await this.save();
    return next;
  }

  async appendBootEvent(id: string, event: Omit<LiveForkBootEvent, "timestamp"> & { timestamp?: string }) {
    const current = this.sessions.get(id);
    if (!current) return undefined;

    const nextEvent = {
      ...event,
      message: redactSecrets(event.message),
      timestamp: event.timestamp ?? new Date().toISOString()
    };

    return this.update(id, {
      boot: {
        phase: nextEvent.phase,
        events: [...current.boot.events, nextEvent],
        error: nextEvent.status === "failed" ? nextEvent.message : current.boot.error
      }
    });
  }

  async recordBootPhase(
    id: string,
    phase: LiveForkBootPhase,
    status: LiveForkBootEventStatus,
    message: string,
    timestamp = new Date().toISOString()
  ) {
    const patch: LiveForkSessionPatch = {
      boot: {
        phase,
        error: status === "failed" ? message : undefined
      }
    };

    if (phase === "failed" || status === "failed") {
      patch.sandbox = { status: "failed" };
    }

    const updated = await this.update(id, patch);
    if (!updated) return undefined;
    return this.appendBootEvent(id, { phase, status, message, timestamp });
  }

  async reconcileActiveSessions(now = new Date().toISOString()) {
    const reconciled: LiveForkSession[] = [];

    for (const session of this.sessions.values()) {
      if (session.sandbox.status !== "starting" && session.sandbox.status !== "running") continue;

      const updated = await this.update(session.id, {
        sandbox: { status: "failed" },
        boot: {
          phase: "failed",
          error: "Control plane restarted and lost the sandbox handle"
        }
      });
      await this.appendBootEvent(session.id, {
        phase: "failed",
        status: "failed",
        message: "Control plane restarted and lost the sandbox handle",
        timestamp: now
      });
      if (updated) reconciled.push(updated);
    }

    return reconciled;
  }

  expiredSessions(now = new Date()) {
    return this.list().filter((session) => {
      if (session.sandbox.status === "stopped" || session.sandbox.status === "failed") return false;
      return new Date(session.lifecycle.expiresAt).getTime() <= now.getTime();
    });
  }

  private async save() {
    if (!this.persist) return;

    const payload = JSON.stringify({ sessions: this.list().map(redactSessionSecrets) } satisfies SessionStoreFile, null, 2);
    const write = this.saveQueue.catch(() => undefined).then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const tmpPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
      await fs.writeFile(tmpPath, `${payload}\n`);
      await fs.rename(tmpPath, this.filePath);
    });

    this.saveQueue = write.then(() => undefined, () => undefined);
    await write;
  }
}

export function redactSession(session: LiveForkSession): RedactedLiveForkSession {
  const { previewToken: _previewToken, ...app } = session.app;
  const { internal: _internal, ...rest } = session;
  return redactSessionSecrets({ ...rest, app });
}

function redactSessionSecrets<T extends Omit<LiveForkSession, "internal"> | LiveForkSession>(session: T): T {
  return {
    ...session,
    repoUrl: redactSecrets(session.repoUrl),
    boot: {
      ...session.boot,
      error: session.boot.error ? redactSecrets(session.boot.error) : undefined,
      events: session.boot.events.map((event) => ({
        ...event,
        message: redactSecrets(event.message)
      }))
    },
    artifacts: {
      ...session.artifacts,
      gitDiff: session.artifacts.gitDiff ? redactSecrets(session.artifacts.gitDiff) : undefined,
      logs: session.artifacts.logs?.map((log) => redactSecrets(log))
    }
  };
}
