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
    dataDir: path.resolve(parsed.VIDEO_HARNESS_DATA_DIR),
    nodeEnv: parsed.NODE_ENV,
  };
}
