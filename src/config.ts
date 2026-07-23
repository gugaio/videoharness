import "dotenv/config";
import path from "node:path";
import { z } from "zod";

const EnvironmentSchema = z.object({
  VIDEO_HARNESS_HOST: z.string().trim().min(1).default("127.0.0.1"),
  VIDEO_HARNESS_PORT: z.coerce.number().int().min(1).max(65_535).default(3210),
  VIDEO_HARNESS_DATABASE_URL: z.string().trim().url().default(
    "postgresql://video_harness:video_harness_local@127.0.0.1:5432/video_harness",
  ),
  VIDEO_HARNESS_WORKER_ID: z.string().trim().min(1).default("worker-local"),
  VIDEO_HARNESS_WORKER_POLL_MS: z.coerce.number().int().min(250).max(60_000).default(2_000),
  VIDEO_HARNESS_WORKER_LEASE_MS: z.coerce.number().int().min(3_000).max(300_000).default(30_000),
  VIDEO_HARNESS_STREAM_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(10_000),
  VIDEO_HARNESS_MANIFEST_MAX_BYTES: z.coerce.number().int().min(1_024).max(10_485_760).default(1_048_576),
  VIDEO_HARNESS_MEDIA_SAMPLE_MAX_BYTES: z.coerce.number().int().min(1_024).max(33_554_432).default(8_388_608),
  VIDEO_HARNESS_MEDIA_SAMPLE_MAX_TOTAL_BYTES: z.coerce.number().int().min(1_024).max(67_108_864).default(16_777_216),
  VIDEO_HARNESS_FFPROBE_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(10_000),
  VIDEO_HARNESS_DATA_DIR: z.string().trim().min(1).default("./.video-harness-data"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type VideoHarnessConfig = {
  host: string;
  port: number;
  databaseUrl: string;
  workerId: string;
  workerPollMs: number;
  workerLeaseMs: number;
  streamTimeoutMs: number;
  manifestMaxBytes: number;
  mediaSampleMaxBytes: number;
  mediaSampleMaxTotalBytes: number;
  ffprobeTimeoutMs: number;
  dataDir: string;
  nodeEnv: "development" | "test" | "production";
};

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): VideoHarnessConfig {
  const parsed = EnvironmentSchema.parse(environment);
  return {
    host: parsed.VIDEO_HARNESS_HOST,
    port: parsed.VIDEO_HARNESS_PORT,
    databaseUrl: parsed.VIDEO_HARNESS_DATABASE_URL,
    workerId: parsed.VIDEO_HARNESS_WORKER_ID,
    workerPollMs: parsed.VIDEO_HARNESS_WORKER_POLL_MS,
    workerLeaseMs: parsed.VIDEO_HARNESS_WORKER_LEASE_MS,
    streamTimeoutMs: parsed.VIDEO_HARNESS_STREAM_TIMEOUT_MS,
    manifestMaxBytes: parsed.VIDEO_HARNESS_MANIFEST_MAX_BYTES,
    mediaSampleMaxBytes: parsed.VIDEO_HARNESS_MEDIA_SAMPLE_MAX_BYTES,
    mediaSampleMaxTotalBytes: parsed.VIDEO_HARNESS_MEDIA_SAMPLE_MAX_TOTAL_BYTES,
    ffprobeTimeoutMs: parsed.VIDEO_HARNESS_FFPROBE_TIMEOUT_MS,
    dataDir: path.resolve(parsed.VIDEO_HARNESS_DATA_DIR),
    nodeEnv: parsed.NODE_ENV,
  };
}
