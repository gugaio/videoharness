import { z } from "zod";
import { investigationStates } from "../investigation/domain/investigation.js";

export const StartInvestigationRequestSchema = z.object({
  url: z.string().trim().url().max(4_096).refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  }, "url must use http or https"),
  problemDescription: z.string().trim().min(1).max(2_000).optional(),
});

export const InvestigationSchema = z.object({
  id: z.string().uuid(),
  sourceUrl: z.string().url(),
  problemDescription: z.string().optional(),
  state: z.enum(investigationStates),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
});

export const StartInvestigationResponseSchema = z.object({
  investigation: InvestigationSchema,
  replayed: z.boolean(),
});
