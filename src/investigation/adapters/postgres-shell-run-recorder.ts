import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { ShellRunRecorder } from "../ports/shell-run-recorder.js";

export class PostgresShellRunRecorder implements ShellRunRecorder {
  constructor(private readonly pool: pg.Pool) {}

  async record(input: Parameters<ShellRunRecorder["record"]>[0]): Promise<string> {
    const id = randomUUID();
    await this.pool.query(
      `INSERT INTO investigation_shell_runs (id, investigation_id, command, exit_code, timed_out, duration_ms, stdout, stderr, output_truncated)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, input.investigationId, input.command.slice(0, 12_000), input.result.exitCode, input.result.timedOut,
        input.result.durationMs, input.result.stdout, input.result.stderr, input.result.outputTruncated],
    );
    return id;
  }
}
