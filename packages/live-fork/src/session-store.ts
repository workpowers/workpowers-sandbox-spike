import type { LiveForkSession } from "./types.js";

export class LiveForkSessionStore {
  private readonly sessions = new Map<string, LiveForkSession>();

  list() {
    return [...this.sessions.values()];
  }

  get(id: string) {
    return this.sessions.get(id);
  }

  set(session: LiveForkSession) {
    this.sessions.set(session.id, session);
    return session;
  }

  update(id: string, patch: Partial<LiveForkSession>) {
    const current = this.sessions.get(id);
    if (!current) return undefined;

    const next = {
      ...current,
      ...patch,
      sandbox: { ...current.sandbox, ...patch.sandbox },
      app: { ...current.app, ...patch.app },
      data: { ...current.data, ...patch.data },
      lifecycle: { ...current.lifecycle, ...patch.lifecycle },
      artifacts: { ...current.artifacts, ...patch.artifacts }
    };

    this.sessions.set(id, next);
    return next;
  }
}
