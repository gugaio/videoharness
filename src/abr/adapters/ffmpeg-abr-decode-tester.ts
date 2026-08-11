import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { DecodeTestResult } from "../domain/evidence.js";
import type { AbrDecodeTester, AbrDecodeTestInput } from "../ports/abr-decode-tester.js";

/** Runs bounded decoder tests with argv arrays; media bytes never become shell commands. */
export class FfmpegAbrDecodeTester implements AbrDecodeTester {
  constructor(private readonly options: { dataDirectory: string; timeoutMs?: number; binary?: string }) {}

  async run(input: AbrDecodeTestInput): Promise<DecodeTestResult[]> {
    const root = path.join(this.options.dataDirectory, "abr-decode-tests");
    await fs.mkdir(root, { recursive: true });
    const workspace = await fs.mkdtemp(path.join(root, "switch-"));
    try {
      const tests: Array<{ test: DecodeTestResult["test"]; bytes?: Uint8Array[] }> = [
        { test: "SOURCE_STANDALONE", bytes: [input.sourceInit, ...input.sourceFragments] },
        { test: "TARGET_STANDALONE", bytes: [input.targetInit, ...input.targetFragments] },
        { test: "TARGET_BOUNDARY", bytes: [input.targetInit, ...input.targetFragments.slice(0, 1)] },
        { test: "SWITCHING_COMPATIBILITY", ...(input.bitstreamSwitchingAllowed ? { bytes: [input.sourceInit, ...input.sourceFragments, ...input.targetFragments] } : {}) },
      ];
      const results: DecodeTestResult[] = [];
      for (const item of tests) {
        const evidenceId = `decode:${input.switchId}:${item.test}`;
        if (!item.bytes) { results.push({ evidenceId, test: item.test, status: "NOT_RUN", warnings: ["The switching contract does not authorize a shared decoder-context test."] }); continue; }
        const file = path.join(workspace, `${item.test.toLowerCase()}.mp4`);
        await fs.writeFile(file, Buffer.concat(item.bytes));
        results.push(await runDecode(this.options.binary ?? "ffmpeg", file, this.options.timeoutMs ?? 120_000, evidenceId, item.test));
      }
      return results;
    } finally { await fs.rm(workspace, { recursive: true, force: true }).catch(() => undefined); }
  }
}

function runDecode(binary: string, file: string, timeoutMs: number, evidenceId: string, test: DecodeTestResult["test"]): Promise<DecodeTestResult> {
  return new Promise((resolve) => {
    const child = spawn(binary, ["-hide_banner", "-nostdin", "-v", "error", "-xerror", "-i", file, "-map", "0:v:0", "-progress", "pipe:1", "-nostats", "-f", "null", "-"], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = ""; let timedOut = false; let settled = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => { stdout = appendBounded(stdout, chunk.toString("utf8")); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = appendBounded(stderr, chunk.toString("utf8")); });
    child.once("error", (error) => finish(null, error.message));
    child.once("close", (code) => finish(code, undefined));
    function finish(code: number | null, spawnError: string | undefined): void {
      if (settled) return; settled = true; clearTimeout(timer);
      const lines = `${spawnError ?? ""}\n${stderr}`.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const frameValues = [...stdout.matchAll(/^frame=(\d+)$/gm)].map((match) => Number(match[1]));
      const outTimeValues = [...stdout.matchAll(/^out_time_us=(\d+)$/gm)].map((match) => Number(match[1]) / 1_000);
      const firstErrorTimestampMs = parseFfmpegTimestamp(lines[0]);
      const decodedFrameCount = frameValues.at(-1); const lastDecodedPts = outTimeValues.at(-1);
      resolve({ evidenceId, test, status: code === 0 && !timedOut ? "PASS" : "FAIL", ...(code === null ? {} : { exitCode: code }), ...(lines[0] ? { firstDecoderError: lines[0] } : {}), ...(firstErrorTimestampMs === undefined ? {} : { firstErrorTimestampMs }), ...(decodedFrameCount === undefined ? {} : { decodedFrameCount }), ...(lastDecodedPts === undefined ? {} : { lastDecodedPts }), warnings: [...(timedOut ? ["FFmpeg decode test timed out."] : []), ...lines.slice(1, 20)], corruptFrames: lines.filter((line) => /corrupt/i.test(line)).length });
    }
  });
}
function appendBounded(current: string, next: string): string { return (current + next).slice(0, 1_000_000); }
function parseFfmpegTimestamp(line: string | undefined): number | undefined { const match = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(line ?? ""); return match ? (Number(match[1]) * 3_600 + Number(match[2]) * 60 + Number(match[3])) * 1_000 : undefined; }
