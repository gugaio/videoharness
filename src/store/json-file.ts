import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const SAFE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_FILE = /^[a-zA-Z0-9._-]+$/;

export class JsonStore {
  constructor(private readonly root: string) {}

  directory(...parts: string[]): string {
    const target = path.resolve(this.root, ...parts);
    const expectedRoot = `${path.resolve(this.root)}${path.sep}`;
    if (!target.startsWith(expectedRoot)) throw new Error("Json store path escapes the data directory");
    return target;
  }

  assertSafeId(id: string): void {
    if (!SAFE_ID.test(id)) throw new Error(`Json store id is invalid: ${id.slice(0, 20)}`);
  }

  assertSafeFile(file: string): void {
    if (!SAFE_FILE.test(file)) throw new Error(`Json store file name is invalid: ${file.slice(0, 40)}`);
  }

  async readJson<T>(...parts: string[]): Promise<T | null> {
    const file = this.directory(...parts);
    try {
      return JSON.parse(await fs.readFile(file, "utf8")) as T;
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async writeJson(value: unknown, ...parts: string[]): Promise<void> {
    const file = this.directory(...parts);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify(value, null, 2), "utf8");
      await fs.rename(temporary, file);
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async appendJsonl(value: unknown, ...parts: string[]): Promise<void> {
    const file = this.directory(...parts);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.appendFile(file, `${JSON.stringify(value)}\n`, "utf8");
  }

  async readJsonl<T>(...parts: string[]): Promise<T[]> {
    const file = this.directory(...parts);
    try {
      const content = await fs.readFile(file, "utf8");
      if (!content) return [];
      const entries: T[] = [];
      for (const line of content.split("\n")) {
        if (line.trim()) entries.push(JSON.parse(line) as T);
      }
      return entries;
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
  }

  async listSubdirectories(...parts: string[]): Promise<string[]> {
    const directory = this.directory(...parts);
    try {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
  }

  async listFiles(...parts: string[]): Promise<string[]> {
    const directory = this.directory(...parts);
    try {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
  }

  async exists(...parts: string[]): Promise<boolean> {
    return fs.access(this.directory(...parts)).then(() => true).catch(() => false);
  }

  async removeDirectory(...parts: string[]): Promise<void> {
    await fs.rm(this.directory(...parts), { recursive: true, force: true });
  }

  async removeFile(...parts: string[]): Promise<void> {
    await fs.rm(this.directory(...parts), { force: true });
  }

  /** Acquires a cross-process lock by atomically creating a directory. Returns the release function. */
  async acquireLock(name: string): Promise<() => Promise<void>> {
    await fs.mkdir(this.directory("locks"), { recursive: true });
    const lock = this.directory(name);
    for (let attempt = 0; attempt < 5_000; attempt += 1) {
      try {
        await fs.mkdir(lock);
        return async () => { await fs.rm(lock, { recursive: true, force: true }); };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        await delay(1);
      }
    }
    throw new Error(`Json store lock was not acquired: ${name}`);
  }

  /** Runs a mutation under a single aggregate lock. Callers must not nest another aggregate lock. */
  async mutate(lockName: string, fn: () => Promise<void>): Promise<void> {
    const release = await this.acquireLock(lockName);
    try {
      await fn();
    } finally {
      await release();
    }
  }

  /** Appends one event to an append-only JSONL log and returns its monotonic id. */
  async appendEvent(input: {
    aggregate: string[];
    event: { type: string; actor: string; message: string; payload: Record<string, unknown> };
  }): Promise<string> {
    const lock = await this.acquireLock(`locks/event-${input.aggregate.join("-")}`);
    try {
      return await this.appendEventUnlocked(input);
    } finally {
      await lock();
    }
  }

  /** Appends an event assuming the caller already holds the aggregate lock. */
  async appendEventUnlocked(input: {
    aggregate: string[];
    event: { type: string; actor: string; message: string; payload: Record<string, unknown> };
  }): Promise<string> {
    const seqFile = [...input.aggregate, "seq.json"];
    const seq = (await this.readJson<{ next: number }>(...seqFile))?.next ?? 1;
    const entry = {
      ...input.event,
      id: String(seq),
      createdAt: new Date().toISOString(),
    };
    await this.appendJsonl(entry, ...input.aggregate, "events.jsonl");
    await this.writeJson({ next: seq + 1 }, ...seqFile);
    return String(seq);
  }
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}