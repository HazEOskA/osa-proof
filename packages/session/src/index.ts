import { randomUUID } from "node:crypto";
import type { Identity, SessionRecord } from "../../contracts/src";

const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000;

function cloneSession(session: SessionRecord): SessionRecord {
  return structuredClone(session);
}

export class SessionStore {
  private readonly sessions = new Map<string, SessionRecord>();

  constructor(private readonly ttlMs = DEFAULT_TTL_MS) {}

  create(identity: Identity): SessionRecord {
    if (!identity.verified) {
      throw new Error("cannot create session for unverified identity");
    }

    const now = Date.now();
    const session: SessionRecord = {
      session_id: `ses_${randomUUID().replace(/-/g, "")}`,
      token: `osa_dev_${randomUUID().replace(/-/g, "")}`,
      identity: structuredClone(identity),
      created_at: new Date(now).toISOString(),
      expires_at: new Date(now + this.ttlMs).toISOString(),
    };

    this.sessions.set(session.token, session);
    return cloneSession(session);
  }

  get(token: string): SessionRecord | undefined {
    const session = this.sessions.get(token);
    if (!session) return undefined;

    if (Date.parse(session.expires_at) <= Date.now()) {
      this.sessions.delete(token);
      return undefined;
    }

    return cloneSession(session);
  }

  revoke(token: string): boolean {
    return this.sessions.delete(token);
  }
}
