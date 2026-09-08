import "dotenv/config";
import { z } from "zod";

const EnvironmentSchema = z.object({
  VH_APP_HOST: z.string().trim().min(1).default("127.0.0.1"),
  VH_APP_PORT: z.coerce.number().int().min(1).max(65_535).default(3210),
  LENS_URL: z.string().url().default("http://lens:8000"),
  MOCK_URL: z.string().url().default("http://mock:8080"),
  VH_SERVICE_TOKEN: z.string().trim().min(1).default("dev-internal-token"),
  CLERK_SECRET_KEY: z
    .string()
    .trim()
    .optional()
    .transform((value) => value || undefined),
});

export type AppConfig = {
  host: string;
  port: number;
  lensUrl: string;
  mockUrl: string;
  serviceToken: string;
  clerkSecretKey?: string;
};

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvironmentSchema.parse(environment);
  return {
    host: parsed.VH_APP_HOST,
    port: parsed.VH_APP_PORT,
    lensUrl: parsed.LENS_URL,
    mockUrl: parsed.MOCK_URL,
    serviceToken: parsed.VH_SERVICE_TOKEN,
    ...(parsed.CLERK_SECRET_KEY ? { clerkSecretKey: parsed.CLERK_SECRET_KEY } : {}),
  };
}
