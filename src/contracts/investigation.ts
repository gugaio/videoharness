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

export const InvestigationDetailResponseSchema = z.object({
  investigation: InvestigationSchema,
});

export const InvestigationEventSchema = z.object({
  id: z.string().regex(/^\d+$/),
  investigationId: z.string().uuid(),
  type: z.string().min(1),
  actor: z.string().min(1),
  message: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
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
  collectedAt: z.string().datetime(),
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
  collectedAt: z.string().datetime(),
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
  })).min(1),
  mediaSamples: z.array(z.object({
    artifactId: z.string().uuid(),
    logicalKey: z.string().min(1),
    kind: z.enum(["init-segment", "media-segment"]),
    sizeBytes: z.number().int().nonnegative(),
  })),
  observations: z.array(EvidenceObservationSchema),
  limitations: z.array(z.string()),
});

const PhaseOneReportContentSchema = z.object({
  placeholder: z.literal(true),
  title: z.string().min(1),
  summary: z.string().min(1),
  problemReported: z.string().optional(),
  findings: z.array(z.object({
    title: z.string().min(1),
    status: z.literal("not_run"),
    explanation: z.string().min(1),
  })),
  confidence: z.object({
    level: z.literal("not_assessed"),
    explanation: z.string().min(1),
  }),
  generatedBy: z.literal("phase-1-lifecycle-fixture"),
});

const ManifestReportContentBaseSchema = z.object({
  placeholder: z.literal(false),
  title: z.string().min(1),
  summary: z.string().min(1),
  problemReported: z.string().optional(),
  findings: z.array(z.object({
    title: z.string().min(1),
    status: z.enum(["observed", "limitation"]),
    explanation: z.string().min(1),
  })),
  confidence: z.object({
    level: z.literal("limited"),
    explanation: z.string().min(1),
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

export const InvestigationReportContentSchema = z.union([
  PhaseOneReportContentSchema,
  ManifestReportContentV1Schema,
  ManifestReportContentV2Schema,
]);

export const InvestigationReportSchema = z.object({
  id: z.string().uuid(),
  investigationId: z.string().uuid(),
  schemaVersion: z.number().int().positive(),
  content: InvestigationReportContentSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const InvestigationReportResponseSchema = z.object({
  report: InvestigationReportSchema,
});
