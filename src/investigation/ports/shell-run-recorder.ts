import type { InvestigationShellResult } from "./investigation-lab.js";

export interface ShellRunRecorder {
  record(input: { investigationId: string; command: string; result: InvestigationShellResult }): Promise<string>;
}
