import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import Fastify from "fastify";
import { z } from "zod";

const InvestigationIdSchema = z.string().uuid();
const RequestSchema = z.object({
  command: z.string().min(1).max(12_000),
  timeoutMs: z.coerce.number().int().min(1_000).max(120_000).default(60_000),
});
const dataDirectory = path.resolve(process.env.VIDEO_HARNESS_DATA_DIR ?? "/data");
const socketPath = process.env.VIDEO_HARNESS_LAB_SOCKET_PATH ?? "/run/video-harness-lab/lab.sock";
const token = process.env.VIDEO_HARNESS_LAB_TOKEN;
const maxOutputBytes = 1_048_576;

if (!token) throw new Error("VIDEO_HARNESS_LAB_TOKEN is required");

const server = Fastify({ logger: true, bodyLimit: 16_384 });
server.addHook("onRequest", async (request, reply) => {
  if (request.headers.authorization !== `Bearer ${token}`) {
    await reply.code(401).send({ error: "Unauthorized" });
  }
});

server.post<{ Params: { investigationId: string }; Body: unknown }>("/v1/labs/:investigationId/exec", async (request, reply) => {
  const investigationId = InvestigationIdSchema.safeParse(request.params.investigationId);
  const body = RequestSchema.safeParse(request.body);
  if (!investigationId.success || !body.success) return reply.code(400).send({ error: "Invalid lab execution request" });
  const workDirectory = path.join(dataDirectory, "workspaces", investigationId.data, "lab", "work");
  const expectedRoot = `${path.join(dataDirectory, "workspaces", investigationId.data, "lab")}${path.sep}`;
  if (!workDirectory.startsWith(expectedRoot)) return reply.code(400).send({ error: "Invalid lab workspace" });
  await fs.mkdir(workDirectory, { recursive: true });
  return executeShell(workDirectory, body.data.command, body.data.timeoutMs);
});

await fs.mkdir(path.dirname(socketPath), { recursive: true });
await fs.rm(socketPath, { force: true });
await server.listen({ path: socketPath });
await fs.chown(socketPath, 0, 10_001);
await fs.chmod(socketPath, 0o660);

function executeShell(cwd: string, command: string, timeoutMs: number): Promise<{
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  outputTruncated: boolean;
}> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn("/bin/bash", ["--noprofile", "--norc", "-lc", command], {
      cwd,
      detached: true,
      uid: 10001,
      gid: 10001,
      env: {
        PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        HOME: cwd,
        LANG: "C.UTF-8",
        LC_ALL: "C.UTF-8",
        TMPDIR: path.join(cwd, "tmp"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let outputTruncated = false;
    let timedOut = false;
    const append = (target: "stdout" | "stderr", chunk: Buffer): void => {
      const remaining = maxOutputBytes - Buffer.byteLength(stdout) - Buffer.byteLength(stderr);
      if (remaining <= 0) { outputTruncated = true; return; }
      const value = chunk.subarray(0, remaining).toString("utf8");
      if (value.length < chunk.length) outputTruncated = true;
      if (target === "stdout") stdout += value;
      else stderr += value;
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid!, "SIGKILL"); } catch { child.kill("SIGKILL"); }
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk));
    child.once("error", (error) => {
      clearTimeout(timeout);
      resolve({ exitCode: null, timedOut: false, durationMs: Date.now() - startedAt, stdout, stderr: `${stderr}${error.message}`, outputTruncated });
    });
    child.once("close", (exitCode) => {
      clearTimeout(timeout);
      resolve({ exitCode, timedOut, durationMs: Date.now() - startedAt, stdout, stderr, outputTruncated });
    });
  });
}
