import { z } from "zod";

export const HealthResponseSchema = z.object({
  ok: z.boolean(),
  service: z.literal("video-harness-api"),
  version: z.string(),
  now: z.string().datetime(),
  uptimeSeconds: z.number().int().nonnegative(),
  storage: z.object({
    status: z.enum(["up", "down"]),
  }),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;