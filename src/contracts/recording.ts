import { z } from "zod";
import { recordingStates } from "../record/domain/recording.js";
import { baselineNetworkProfile } from "../record/domain/playback-run.js";

export const CreateRecordingRequestSchema = z.object({
  url: z.string().trim().url().max(4_096).refine((value) => {
    const parsed = new URL(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && !parsed.username && !parsed.password;
  }, "url must use HTTP(S) without credentials"),
  durationSeconds: z.number().int().min(30).max(600).default(120),
  startSeconds: z.number().int().min(0).max(86_400).default(0),
  protocol: z.enum(["hls", "dash"]).default("hls"),
});

export const RecordingSchema = z.object({
  id: z.string().uuid(),
  sourceUrl: z.string().url(),
  protocol: z.enum(["hls", "dash"]),
  state: z.enum(recordingStates),
  requestedDurationSeconds: z.number().int(),
  requestedStartSeconds: z.number().int(),
  coverageSeconds: z.number().nonnegative().optional(),
  totalBytes: z.number().int().nonnegative().optional(),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
});

export const StartRecordingResponseSchema = z.object({ recording: RecordingSchema, replayed: z.boolean() });
export const RecordingDetailResponseSchema = z.object({ recording: RecordingSchema });
export const RecordingEventSchema = z.object({
  id: z.string().regex(/^\d+$/),
  recordingId: z.string().uuid(),
  type: z.string().min(1),
  actor: z.string().min(1),
  message: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
});

export const CreatePlaybackRunRequestSchema = z.object({
  maxDurationSeconds: z.number().int().min(30).max(900).default(300),
  profile: z.object({
    schemaVersion: z.literal(1),
    name: z.string().trim().min(1).max(80),
    stages: z.array(z.object({
      afterVideoRequests: z.number().int().min(0).max(10_000),
      bandwidthKbps: z.number().int().min(128).max(100_000),
      latencyMs: z.number().int().min(0).max(5_000),
    })).min(1).max(8),
  }).superRefine((profile, context) => {
    if (profile.stages[0]?.afterVideoRequests !== 0) context.addIssue({ code: z.ZodIssueCode.custom, message: "first stage must start at zero" });
    for (let index = 1; index < profile.stages.length; index += 1) {
      if (profile.stages[index]!.afterVideoRequests <= profile.stages[index - 1]!.afterVideoRequests) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "stages must be strictly increasing" });
      }
    }
  }).default(baselineNetworkProfile),
});
