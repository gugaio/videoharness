import { randomUUID } from "node:crypto";
import { JsonStore } from "../../store/json-file.js";
import type { ShellRunRecorder } from "../ports/shell-run-recorder.js";

export class FilesystemShellRunRecorder implements ShellRunRecorder {
  constructor(private readonly store: JsonStore) {}

  async record(input: Parameters<ShellRunRecorder["record"]>[0]): Promise<string> {
    const id = randomUUID();
    await this.store.appendJsonl(
      { id, investigationId: input.investigationId, command: input.command.slice(0, 12_000), result: input.result },
      "investigations", input.investigationId, "shell-runs.jsonl",
    );
    return id;
  }
}