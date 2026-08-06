import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHlsContext } from "./hls.js";
import { runOrThrow, runProcess } from "./process.js";
import type { Detector, DetectorInterval, EvalCase, FixtureEvaluation, IntervalExpectation } from "./types.js";

const detectorArguments: Record<Detector, (playlistPath: string) => string[]> = {
  freezedetect: (playlistPath) => [
    "-hide_banner", "-nostdin", "-loglevel", "info", "-protocol_whitelist", "file,crypto,data",
    "-i", playlistPath, "-map", "0:v:0", "-vf", "freezedetect=n=-50dB:d=0.4", "-an", "-f", "null", "-",
  ],
  blackdetect: (playlistPath) => [
    "-hide_banner", "-nostdin", "-loglevel", "info", "-protocol_whitelist", "file,crypto,data",
    "-i", playlistPath, "-map", "0:v:0", "-vf", "blackdetect=d=0.4:pix_th=0.10", "-an", "-f", "null", "-",
  ],
  silencedetect: (playlistPath) => [
    "-hide_banner", "-nostdin", "-loglevel", "info", "-protocol_whitelist", "file,crypto,data",
    "-i", playlistPath, "-map", "0:a:0", "-af", "silencedetect=n=-50dB:d=0.4", "-vn", "-f", "null", "-",
  ],
};

const detectorKeys: Record<Detector, { start: string; duration: string; end: string }> = {
  freezedetect: { start: "freeze_start", duration: "freeze_duration", end: "freeze_end" },
  blackdetect: { start: "black_start", duration: "black_duration", end: "black_end" },
  silencedetect: { start: "silence_start", duration: "silence_duration", end: "silence_end" },
};

export async function runFixtureCase(evalCase: EvalCase, keep = false): Promise<FixtureEvaluation> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), `video-harness-eval-${evalCase.id}-`));
  try {
    const context = createHlsContext(directory, async (args) => { await runOrThrow("ffmpeg", args, 60_000); });
    await evalCase.generate(context);
    await assertHlsFixture(context.playlistPath);
    const intervals = await detectIntervals(evalCase.detector, context.playlistPath);
    assertIntervals(evalCase, intervals);
    return { id: evalCase.id, directory, detector: evalCase.detector, intervals, retained: keep };
  } finally {
    if (!keep) await fs.rm(directory, { recursive: true, force: true });
  }
}

async function assertHlsFixture(playlistPath: string): Promise<void> {
  const playlist = await fs.readFile(playlistPath, "utf8");
  if (!playlist.startsWith("#EXTM3U\n") || !playlist.includes("#EXT-X-TARGETDURATION:") || !playlist.includes("#EXT-X-ENDLIST")) {
    throw new Error("Generated fixture is not a complete HLS VOD playlist");
  }
  const segmentNames = playlist.split("\n").filter((line) => /^segment-\d+\.ts$/.test(line));
  if (segmentNames.length < 3) throw new Error("Generated fixture must contain at least three HLS segments");
  await Promise.all(segmentNames.map(async (name) => {
    const stats = await fs.stat(path.join(path.dirname(playlistPath), name));
    if (stats.size === 0) throw new Error(`Generated segment ${name} is empty`);
  }));
  const probe = await runOrThrow("ffprobe", [
    "-v", "error", "-protocol_whitelist", "file,crypto,data", "-show_entries", "stream=codec_name,codec_type", "-of", "json", playlistPath,
  ]);
  const parsed = JSON.parse(probe.stdout) as { streams?: Array<{ codec_name?: string; codec_type?: string }> };
  const streams = parsed.streams ?? [];
  if (!streams.some((stream) => stream.codec_type === "video" && stream.codec_name === "h264")) throw new Error("Generated fixture has no H.264 video track");
  if (!streams.some((stream) => stream.codec_type === "audio" && stream.codec_name === "aac")) throw new Error("Generated fixture has no AAC audio track");
}

async function detectIntervals(detector: Detector, playlistPath: string): Promise<DetectorInterval[]> {
  const result = await runProcess("ffmpeg", detectorArguments[detector](playlistPath), 60_000);
  if (result.exitCode !== 0 || result.timedOut) throw new Error(`${detector} could not inspect generated fixture: ${result.stderr}`);
  return parseIntervals(detector, `${result.stdout}\n${result.stderr}`);
}

function parseIntervals(detector: Detector, output: string): DetectorInterval[] {
  const keys = detectorKeys[detector];
  const starts = extractValues(output, keys.start);
  const durations = extractValues(output, keys.duration);
  const ends = extractValues(output, keys.end);
  return starts.flatMap((startSeconds, index) => {
    const durationSeconds = durations[index];
    const endSeconds = ends[index];
    if (durationSeconds === undefined && endSeconds === undefined) return [];
    const resolvedDuration = durationSeconds ?? endSeconds! - startSeconds;
    return [{ startSeconds, durationSeconds: resolvedDuration, endSeconds: endSeconds ?? startSeconds + resolvedDuration }];
  });
}

function extractValues(output: string, key: string): number[] {
  const expression = new RegExp(`${key}:\\s*([0-9]+(?:\\.[0-9]+)?)`, "g");
  return Array.from(output.matchAll(expression), (match) => Number(match[1]));
}

function assertIntervals(evalCase: EvalCase, intervals: DetectorInterval[]): void {
  if (!evalCase.expectedInterval) {
    if (intervals.length !== 0) throw new Error(`${evalCase.id} unexpectedly produced ${evalCase.detector} evidence`);
    return;
  }
  if (!intervals.some((interval) => isInRange(interval.startSeconds, evalCase.expectedInterval!.startSeconds)
    && isInRange(interval.durationSeconds, evalCase.expectedInterval!.durationSeconds))) {
    throw new Error(`${evalCase.id} did not produce the expected ${evalCase.detector} interval; observed ${JSON.stringify(intervals)}`);
  }
}

function isInRange(value: number, range: IntervalExpectation["startSeconds"]): boolean {
  return value >= range.min && value <= range.max;
}
