import { z } from "zod";

const HealthSchema = z.object({
  ok: z.boolean(),
  service: z.literal("video-harness-api"),
  version: z.string(),
  now: z.string(),
  database: z.object({ status: z.enum(["up", "down"]) }),
});

const InvestigationSchema = z.object({
  id: z.string().uuid(),
  sourceUrl: z.string().url(),
  problemDescription: z.string().optional(),
  state: z.enum(["queued", "validating", "collecting", "analyzing", "synthesizing", "completed", "failed"]),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().optional(),
});

export const InvestigationEventSchema = z.object({
  id: z.string().regex(/^\d+$/),
  investigationId: z.string().uuid(),
  type: z.string(),
  actor: z.string(),
  message: z.string(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});

const InvestigationReportSchema = z.object({
  id: z.string().uuid(),
  investigationId: z.string().uuid(),
  schemaVersion: z.number().int().positive(),
  content: z.object({
    placeholder: z.literal(true),
    title: z.string(),
    summary: z.string(),
    problemReported: z.string().optional(),
    findings: z.array(z.object({
      title: z.string(),
      status: z.literal("not_run"),
      explanation: z.string(),
    })),
    confidence: z.object({
      level: z.literal("not_assessed"),
      explanation: z.string(),
    }),
    generatedBy: z.literal("phase-1-lifecycle-fixture"),
  }),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Health = z.infer<typeof HealthSchema>;
export type Investigation = z.infer<typeof InvestigationSchema>;
export type InvestigationEvent = z.infer<typeof InvestigationEventSchema>;
export type InvestigationReport = z.infer<typeof InvestigationReportSchema>;

export async function getHealth(): Promise<Health> {
  const response = await fetch("/v1/health");
  const payload: unknown = await response.json();
  return HealthSchema.parse(payload);
}

async function parseResponse<T>(response: Response, schema: z.ZodSchema<T>): Promise<T> {
  const payload: unknown = await response.json();
  if (!response.ok) {
    const error = z.object({ error: z.object({ message: z.string() }) }).safeParse(payload);
    throw new Error(error.success ? error.data.error.message : `Request failed with status ${response.status}`);
  }
  return schema.parse(payload);
}

export async function startInvestigation(input: {
  url: string;
  problemDescription?: string;
}): Promise<{ investigation: Investigation; replayed: boolean }> {
  const response = await fetch("/v1/investigations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(input),
  });
  return parseResponse(response, z.object({ investigation: InvestigationSchema, replayed: z.boolean() }));
}

export async function getInvestigation(id: string): Promise<Investigation> {
  const response = await fetch(`/v1/investigations/${encodeURIComponent(id)}`);
  const result = await parseResponse(response, z.object({ investigation: InvestigationSchema }));
  return result.investigation;
}

export async function getInvestigationReport(id: string): Promise<InvestigationReport> {
  const response = await fetch(`/v1/investigations/${encodeURIComponent(id)}/report`);
  const result = await parseResponse(response, z.object({ report: InvestigationReportSchema }));
  return result.report;
}
