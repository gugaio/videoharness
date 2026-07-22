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

const PhaseOneReportContentSchema = z.object({
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
});

const EvidenceSourceSchema = z.object({
  requestedUrl: z.string().url(),
  finalUrl: z.string().url(),
  protocol: z.enum(["hls", "dash"]),
  httpStatus: z.number().int(),
  contentType: z.string().optional(),
});

const EvidenceObservationSchema = z.object({
  code: z.string(),
  severity: z.enum(["info", "warning", "error"]),
  message: z.string(),
});

const EvidenceBundleV1Schema = z.object({
  schemaVersion: z.literal(1),
  collectedAt: z.string(),
  source: EvidenceSourceSchema,
  manifest: z.object({
    artifactId: z.string().uuid(),
    kind: z.enum(["master", "media", "mpd"]),
    sizeBytes: z.number().int().nonnegative(),
    variantCount: z.number().int().nonnegative().optional(),
    segmentCount: z.number().int().nonnegative().optional(),
    representationCount: z.number().int().nonnegative().optional(),
  }),
  observations: z.array(EvidenceObservationSchema),
  limitations: z.array(z.string()),
});

const EvidenceBundleV2Schema = z.object({
  schemaVersion: z.literal(2),
  collectedAt: z.string(),
  source: EvidenceSourceSchema,
  manifests: z.array(z.object({
    artifactId: z.string().uuid(),
    logicalKey: z.string().min(1),
    role: z.enum(["root", "variant", "rendition"]),
    requestedUrl: z.string().url(),
    finalUrl: z.string().url(),
    kind: z.enum(["master", "media", "mpd"]),
    sizeBytes: z.number().int().nonnegative(),
    variantCount: z.number().int().nonnegative().optional(),
    segmentCount: z.number().int().nonnegative().optional(),
    representationCount: z.number().int().nonnegative().optional(),
    targetDuration: z.number().nonnegative().optional(),
    mediaSequence: z.number().nonnegative().optional(),
    discontinuitySequence: z.number().nonnegative().optional(),
    discontinuityCount: z.number().int().nonnegative().optional(),
    hasEndList: z.boolean().optional(),
  })).min(1),
  mediaSamples: z.array(z.object({
    artifactId: z.string().uuid(),
    logicalKey: z.string().min(1),
    kind: z.enum(["init-segment", "media-segment"]),
    sizeBytes: z.number().int().nonnegative(),
  })),
  hls: z.object({
    variants: z.array(z.object({
      index: z.number().int().nonnegative(),
      uri: z.string(),
      url: z.string().url().optional(),
      bandwidth: z.number().nonnegative().optional(),
      averageBandwidth: z.number().nonnegative().optional(),
      resolution: z.string().optional(),
      frameRate: z.number().nonnegative().optional(),
      codecs: z.string().optional(),
      audioGroupId: z.string().optional(),
      subtitlesGroupId: z.string().optional(),
      closedCaptions: z.string().optional(),
    })),
    renditions: z.array(z.object({
      index: z.number().int().nonnegative(),
      type: z.string(),
      groupId: z.string().optional(),
      name: z.string().optional(),
      language: z.string().optional(),
      default: z.boolean().optional(),
      autoselect: z.boolean().optional(),
      forced: z.boolean().optional(),
      channels: z.string().optional(),
      characteristics: z.string().optional(),
      uri: z.string().optional(),
      url: z.string().url().optional(),
    })),
    selection: z.object({
      rule: z.literal("highest-bandwidth"),
      variantIndex: z.number().int().nonnegative(),
      variantLogicalKey: z.string().optional(),
      audioRenditionIndex: z.number().int().nonnegative().optional(),
      audioRenditionLogicalKey: z.string().optional(),
    }).optional(),
  }).optional(),
  observations: z.array(EvidenceObservationSchema),
  limitations: z.array(z.string()),
});

const ManifestReportContentBaseSchema = z.object({
  placeholder: z.literal(false),
  title: z.string(),
  summary: z.string(),
  problemReported: z.string().optional(),
  findings: z.array(z.object({
    title: z.string(),
    status: z.enum(["observed", "limitation"]),
    explanation: z.string(),
  })),
  confidence: z.object({
    level: z.literal("limited"),
    explanation: z.string(),
  }),
});

const ManifestReportContentV1Schema = ManifestReportContentBaseSchema.extend({
  evidence: EvidenceBundleV1Schema,
  generatedBy: z.literal("deterministic-manifest-v1"),
});

const ManifestReportContentV2Schema = ManifestReportContentBaseSchema.extend({
  evidence: EvidenceBundleV2Schema,
  generatedBy: z.literal("deterministic-manifest-v2"),
});

const InvestigationReportSchema = z.object({
  id: z.string().uuid(),
  investigationId: z.string().uuid(),
  schemaVersion: z.number().int().positive(),
  content: z.union([PhaseOneReportContentSchema, ManifestReportContentV1Schema, ManifestReportContentV2Schema]),
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
