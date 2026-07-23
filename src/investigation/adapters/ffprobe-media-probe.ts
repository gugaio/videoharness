import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { MediaProbe, MediaProbeResult, MediaProbeTrack } from "../ports/media-sample-collector.js";

const FfprobeOutputSchema = z.object({
  format: z.object({ format_name: z.string().optional(), duration: z.union([z.string(), z.number()]).optional() }).optional(),
  streams: z.array(z.object({
    index: z.number().int(), codec_type: z.string().optional(), codec_name: z.string().optional(),
    duration: z.union([z.string(), z.number()]).optional(), width: z.number().optional(), height: z.number().optional(),
    r_frame_rate: z.string().optional(), sample_rate: z.union([z.string(), z.number()]).optional(), channels: z.number().optional(),
  })).optional(),
  packets: z.array(z.object({
    stream_index: z.number().int(), pts_time: z.union([z.string(), z.number()]).optional(),
    dts_time: z.union([z.string(), z.number()]).optional(),
  })).optional(),
});

export class FfprobeMediaProbe implements MediaProbe {
  constructor(private readonly options: { dataDirectory: string; timeoutMs: number; maxOutputBytes?: number; binary?: string }) {}

  async probe(input: Parameters<MediaProbe["probe"]>[0]): Promise<MediaProbeResult> {
    const directory = path.join(this.options.dataDirectory, "workspaces", input.investigationId);
    const file = path.join(directory, `${input.sample.logicalKey.replace(/[^a-z0-9]+/gi, "-")}.mp4`);
    await fs.mkdir(directory, { recursive: true });
    try {
      await fs.writeFile(file, input.initBytes ? Buffer.concat([input.initBytes, input.sample.content.bytes]) : input.sample.content.bytes);
      const output = await runFfprobe(this.options.binary ?? "ffprobe", file, this.options.timeoutMs, this.options.maxOutputBytes ?? 4_194_304);
      const parsed = FfprobeOutputSchema.safeParse(JSON.parse(output));
      if (!parsed.success) throw new Error("FFprobe returned an invalid media description");
      const packetsByStream = new Map<number, number[]>();
      for (const packet of parsed.data.packets ?? []) {
        const value = finite(packet.pts_time) ?? finite(packet.dts_time);
        if (value === undefined) continue;
        const values = packetsByStream.get(packet.stream_index) ?? [];
        values.push(value);
        packetsByStream.set(packet.stream_index, values);
      }
      const tracks: MediaProbeTrack[] = (parsed.data.streams ?? []).map((stream) => {
        const timestamps = packetsByStream.get(stream.index) ?? [];
        const duration = finite(stream.duration);
        const sampleRate = finite(stream.sample_rate);
        const firstPts = timestamps[0];
        const lastPts = timestamps.at(-1);
        return {
          kind: stream.codec_type === "video" ? "video" : stream.codec_type === "audio" ? "audio" : "other",
          ...(stream.codec_name ? { codec: stream.codec_name } : {}),
          ...(duration === undefined ? {} : { duration }),
          ...(firstPts === undefined ? {} : { firstPts }),
          ...(lastPts === undefined ? {} : { lastPts }),
          ...(stream.width === undefined ? {} : { width: stream.width }),
          ...(stream.height === undefined ? {} : { height: stream.height }),
          ...(stream.r_frame_rate ? { frameRate: stream.r_frame_rate } : {}),
          ...(sampleRate === undefined ? {} : { sampleRate }),
          ...(stream.channels === undefined ? {} : { channels: stream.channels }),
        };
      });
      const duration = finite(parsed.data.format?.duration);
      return {
        ...(parsed.data.format?.format_name ? { format: parsed.data.format.format_name } : {}),
        ...(duration === undefined ? {} : { duration }),
        tracks,
      };
    } finally {
      await fs.rm(file, { force: true }).catch(() => undefined);
    }
  }
}

function finite(value: string | number | undefined): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function runFfprobe(binary: string, input: string, timeoutMs: number, maxOutputBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, [
      "-v", "error", "-show_format", "-show_streams", "-show_packets",
      "-show_entries", "format=format_name,duration:stream=index,codec_type,codec_name,duration,width,height,r_frame_rate,sample_rate,channels:packet=stream_index,pts_time,dts_time",
      "-of", "json", input,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (callback: () => void): void => { if (!settled) { settled = true; clearTimeout(timer); callback(); } };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(() => reject(new Error("FFprobe timed out")));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
      if (Buffer.byteLength(stdout) > maxOutputBytes) {
        child.kill("SIGKILL");
        finish(() => reject(new Error("FFprobe output exceeded the allowed size")));
      }
    });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf-8"); });
    child.once("error", () => finish(() => reject(new Error("FFprobe is unavailable"))));
    child.once("close", (code) => {
      if (code === 0) finish(() => resolve(stdout));
      else finish(() => reject(new Error(`FFprobe failed${stderr.trim() ? `: ${stderr.trim().slice(0, 300)}` : ""}`)));
    });
  });
}
