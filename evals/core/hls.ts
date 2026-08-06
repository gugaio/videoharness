import path from "node:path";
import type { EvalGenerationContext } from "./types.js";

const durationSeconds = 12;

export function createHlsContext(directory: string, ffmpeg: (args: string[]) => Promise<void>): EvalGenerationContext {
  return {
    directory,
    playlistPath: path.join(directory, "index.m3u8"),
    segmentPattern: path.join(directory, "segment-%03d.ts"),
    ffmpeg,
  };
}

export async function generateSyntheticHls(context: EvalGenerationContext, filterComplex: string): Promise<void> {
  await context.ffmpeg([
    "-hide_banner", "-nostdin", "-y",
    "-f", "lavfi", "-i", `testsrc2=size=640x360:rate=30:duration=${durationSeconds}`,
    "-f", "lavfi", "-i", `sine=frequency=880:sample_rate=48000:duration=${durationSeconds}`,
    "-filter_complex", filterComplex,
    "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
    "-g", "120", "-keyint_min", "120", "-sc_threshold", "0",
    "-force_key_frames", "expr:gte(t,n_forced*4)",
    "-c:a", "aac", "-b:a", "128k",
    "-f", "hls", "-hls_time", "4", "-hls_playlist_type", "vod",
    "-hls_segment_filename", context.segmentPattern,
    context.playlistPath,
  ]);
}
