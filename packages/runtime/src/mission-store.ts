import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { MissionRecord } from "../../contracts/src";
import { canonicalJson, digest } from "../../proof-core/src";

export class MissionConflictError extends Error {}
export interface MissionStore {
  readonly persistence: "PROCESS_MEMORY" | "LOCAL_FILESYSTEM";
  get(missionId: string): Promise<MissionRecord | undefined>;
  // undefined means create-only. Revisions are optimistic concurrency tokens.
  save(record: MissionRecord, expectedRevision?: number): Promise<void>;
}
function checkRevision(current: MissionRecord | undefined, next: MissionRecord, expected?: number): void {
  if (current?.revision !== expected || next.revision !== (expected ?? 0) + 1) {
    throw new MissionConflictError("mission revision conflict");
  }
}
export class MemoryMissionStore implements MissionStore {
  readonly persistence = "PROCESS_MEMORY" as const;
  private readonly records = new Map<string, MissionRecord>();
  async get(id: string): Promise<MissionRecord | undefined> {
    return structuredClone(this.records.get(id));
  }
  async save(record: MissionRecord, expectedRevision?: number): Promise<void> {
    checkRevision(this.records.get(record.mission.mission_id), record, expectedRevision);
    this.records.set(record.mission.mission_id, structuredClone(record));
  }
}
// Local filesystem persistence. No distributed filesystem assumptions or automatic
// stale-lock takeover: after a crash a leftover lock fails closed for operator recovery.
export class FileMissionStore implements MissionStore {
  readonly persistence = "LOCAL_FILESYSTEM" as const;
  constructor(private readonly directory: string) {}
  private path(id: string): string { return join(this.directory, `${digest(id)}.json`); }
  async get(id: string): Promise<MissionRecord | undefined> {
    try {
      const envelope = JSON.parse(await readFile(this.path(id), "utf8")) as { record: MissionRecord; sha256: string };
      if (envelope.record.schema !== "osa.mission.v1" || !Number.isInteger(envelope.record.revision) || envelope.record.revision < 1 ||
          digest(envelope.record) !== envelope.sha256 || envelope.record.mission.mission_id !== id) {
        throw new Error("mission snapshot integrity failure");
      }
      return envelope.record;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }
  async save(record: MissionRecord, expectedRevision?: number): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const path = this.path(record.mission.mission_id);
    let lock;
    try { lock = await open(`${path}.lock`, "wx", 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new MissionConflictError("mission is locked");
      throw error;
    }
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      checkRevision(await this.get(record.mission.mission_id), record, expectedRevision);
      const file = await open(temporary, "wx", 0o600);
      try {
        await file.writeFile(canonicalJson({ record, sha256: digest(record) }));
        await file.sync();
      } finally { await file.close(); }
      await rename(temporary, path);
      const directory = await open(this.directory, "r");
      try { await directory.sync(); } finally { await directory.close(); }
    } finally {
      try { await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; }); }
      finally { try { await lock.close(); } finally { await unlink(`${path}.lock`); } }
    }
  }
}
