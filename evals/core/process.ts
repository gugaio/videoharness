import { spawn } from "node:child_process";

export type ProcessResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

export class ProcessExecutionError extends Error {
  constructor(readonly command: string, readonly result: ProcessResult) {
    super(`${command} failed with exit code ${result.exitCode ?? "null"}${result.timedOut ? " after timeout" : ""}`);
  }
}

export async function runProcess(binary: string, args: string[], timeoutMs = 60_000): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr, timedOut });
    });
  });
}

export async function runOrThrow(binary: string, args: string[], timeoutMs?: number): Promise<ProcessResult> {
  const result = await runProcess(binary, args, timeoutMs);
  if (result.exitCode !== 0 || result.timedOut) throw new ProcessExecutionError([binary, ...args].join(" "), result);
  return result;
}
