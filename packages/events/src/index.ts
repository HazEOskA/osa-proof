import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { RuntimeEvent } from "../../contracts/src";

export interface EventStore {
  append(event: RuntimeEvent): Promise<void>;
  list(runId: string): Promise<RuntimeEvent[]>;
}

export class MemoryEventStore implements EventStore {
  protected readonly events: RuntimeEvent[] = [];

  async append(event: RuntimeEvent): Promise<void> {
    this.events.push(structuredClone(event));
  }

  async list(runId: string): Promise<RuntimeEvent[]> {
    return this.events.filter((event) => event.run_id === runId).map((event) => structuredClone(event));
  }
}

export class JsonlEventStore implements EventStore {
  constructor(private readonly filePath: string) {}

  async append(event: RuntimeEvent): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify(event)}\n`, "utf8");
  }

  async list(runId: string): Promise<RuntimeEvent[]> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return [];
      throw error;
    }

    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as RuntimeEvent)
      .filter((event) => event.run_id === runId);
  }
}
