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
  VIDEO_HARNESS_STREAM_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(25_000),
  VIDEO_HARNESS_STREAM_LOCALHOST_ALIAS: z.string().trim()
    .regex(/^[a-zA-Z0-9.-]+$/, "Localhost alias must be a hostname or IP address")
    .optional()
    .transform((value) => value || undefined),
  VIDEO_HARNESS_MANIFEST_MAX_BYTES: z.coerce.number().int().min(1_024).max(10_485_760).default(1_048_576),
  VIDEO_HARNESS_MEDIA_SAMPLE_MAX_BYTES: z.coerce.number().int().min(1_024).max(134_217_728).default(134_217_728),
  VIDEO_HARNESS_MEDIA_SAMPLE_MAX_TOTAL_BYTES: z.coerce.number().int().min(1_024).max(1_073_741_824).default(536_870_912),
  VIDEO_HARNESS_MEDIA_SAMPLE_MAX_SECONDS: z.coerce.number().int().min(1).max(600).default(60),
  VIDEO_HARNESS_MEDIA_SAMPLE_MODE: z.enum(["sample", "full"]).default("full"),
  VIDEO_HARNESS_RECORD_SEGMENT_MAX_BYTES: z.coerce.number().int().min(1_024).max(67_108_864).default(67_108_864),
  VIDEO_HARNESS_RECORD_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(60_000),
  VIDEO_HARNESS_RECORD_MAX_TOTAL_BYTES: z.coerce.number().int().min(1_024).max(1_073_741_824).default(1_073_741_824),
  VIDEO_HARNESS_RECORD_MAX_VARIANTS: z.coerce.number().int().min(2).max(32).default(32),
  VIDEO_HARNESS_EXPERIMENT_MAX_CLONES_PER_ITERATION: z.coerce.number().int().min(1).max(8).default(4),
  VIDEO_HARNESS_EXPERIMENT_MAX_ITERATIONS: z.coerce.number().int().min(1).max(10).default(3),
  VIDEO_HARNESS_EXPERIMENT_MAX_CLONES_TOTAL: z.coerce.number().int().min(1).max(40).default(12),
  VIDEO_HARNESS_FFPROBE_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(10_000),
  VIDEO_HARNESS_LAB_SOCKET_PATH: z.string().trim().min(1).optional().transform((value) => value || undefined),
  VIDEO_HARNESS_LAB_TOKEN: z.string().trim().min(16).optional().transform((value) => value || undefined),
  VIDEO_HARNESS_LAB_COMMAND_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(60_000),
  VIDEO_HARNESS_AI_PROVIDER: z.string().trim().min(1).default("openai"),
  VIDEO_HARNESS_AI_API_URL: z.string().trim().url().default("https://api.openai.com/v1/chat/completions"),
  VIDEO_HARNESS_AI_MODEL: z.string().trim().min(1).default("gpt-5.6-luna"),
  VIDEO_HARNESS_AI_API_KEY: z.string().trim().optional().transform((value) => value || undefined),
  VIDEO_HARNESS_AI_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(180_000).default(45_000),
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
  streamLocalhostAlias?: string;
  manifestMaxBytes: number;
  mediaSampleMaxBytes: number;
  mediaSampleMaxTotalBytes: number;
  mediaSampleMaxSeconds: number;
  mediaSampleMode: "sample" | "full";
  recordSegmentMaxBytes: number;
  recordRequestTimeoutMs: number;
  recordMaxTotalBytes: number;
  recordMaxVariants: number;
  experimentMaxClonesPerIteration: number;
  experimentMaxIterations: number;
  experimentMaxClonesTotal: number;
  ffprobeTimeoutMs: number;
  labSocketPath?: string;
  labToken?: string;
  labCommandTimeoutMs: number;
  aiProvider: string;
  aiApiUrl: string;
  aiModel: string;
  aiApiKey?: string;
  aiTimeoutMs: number;
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
    ...(parsed.VIDEO_HARNESS_STREAM_LOCALHOST_ALIAS
      ? { streamLocalhostAlias: parsed.VIDEO_HARNESS_STREAM_LOCALHOST_ALIAS }
      : {}),
    manifestMaxBytes: parsed.VIDEO_HARNESS_MANIFEST_MAX_BYTES,
    mediaSampleMaxBytes: parsed.VIDEO_HARNESS_MEDIA_SAMPLE_MAX_BYTES,
    mediaSampleMaxTotalBytes: parsed.VIDEO_HARNESS_MEDIA_SAMPLE_MAX_TOTAL_BYTES,
    mediaSampleMaxSeconds: parsed.VIDEO_HARNESS_MEDIA_SAMPLE_MAX_SECONDS,
    mediaSampleMode: parsed.VIDEO_HARNESS_MEDIA_SAMPLE_MODE,
    recordSegmentMaxBytes: parsed.VIDEO_HARNESS_RECORD_SEGMENT_MAX_BYTES,
    recordRequestTimeoutMs: parsed.VIDEO_HARNESS_RECORD_REQUEST_TIMEOUT_MS,
    recordMaxTotalBytes: parsed.VIDEO_HARNESS_RECORD_MAX_TOTAL_BYTES,
    recordMaxVariants: parsed.VIDEO_HARNESS_RECORD_MAX_VARIANTS,
    experimentMaxClonesPerIteration: parsed.VIDEO_HARNESS_EXPERIMENT_MAX_CLONES_PER_ITERATION,
    experimentMaxIterations: parsed.VIDEO_HARNESS_EXPERIMENT_MAX_ITERATIONS,
    experimentMaxClonesTotal: parsed.VIDEO_HARNESS_EXPERIMENT_MAX_CLONES_TOTAL,
    ffprobeTimeoutMs: parsed.VIDEO_HARNESS_FFPROBE_TIMEOUT_MS,
    ...(parsed.VIDEO_HARNESS_LAB_SOCKET_PATH ? { labSocketPath: parsed.VIDEO_HARNESS_LAB_SOCKET_PATH } : {}),
    ...(parsed.VIDEO_HARNESS_LAB_TOKEN ? { labToken: parsed.VIDEO_HARNESS_LAB_TOKEN } : {}),
    labCommandTimeoutMs: parsed.VIDEO_HARNESS_LAB_COMMAND_TIMEOUT_MS,
    aiProvider: parsed.VIDEO_HARNESS_AI_PROVIDER,
    aiApiUrl: parsed.VIDEO_HARNESS_AI_API_URL,
    aiModel: parsed.VIDEO_HARNESS_AI_MODEL,
    ...(parsed.VIDEO_HARNESS_AI_API_KEY ? { aiApiKey: parsed.VIDEO_HARNESS_AI_API_KEY } : {}),
    aiTimeoutMs: parsed.VIDEO_HARNESS_AI_TIMEOUT_MS,
    dataDir: path.resolve(parsed.VIDEO_HARNESS_DATA_DIR),
    nodeEnv: parsed.NODE_ENV,
  };
}
