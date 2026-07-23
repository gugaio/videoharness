export type InvestigationShellResult = {
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  outputTruncated: boolean;
};

/**
 * A real shell boundary for an investigation. Implementations must execute it
 * outside the coordinator process: the worker owns database and AI secrets.
 */
export interface InvestigationLab {
  execute(input: {
    investigationId: string;
    command: string;
    timeoutMs?: number;
  }): Promise<InvestigationShellResult>;
}
