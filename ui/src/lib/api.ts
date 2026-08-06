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
    sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
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
    sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
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
    sourceManifestLogicalKey: z.string().min(1).optional(),
    sampleIndex: z.number().int().nonnegative().optional(),
    sequence: z.number().int().nonnegative().optional(),
    declaredDuration: z.number().nonnegative().optional(),
    representationId: z.string().optional(), periodIndex: z.number().int().nonnegative().optional(), adaptationSetIndex: z.number().int().nonnegative().optional(),
    presentationStartSeconds: z.number().optional(), presentationEndSeconds: z.number().optional(),
    source: z.object({ url: z.string().url(), sha256: z.string().regex(/^[a-f0-9]{64}$/), observedHashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)).min(1).max(3).optional(), httpStatus: z.number().int(), contentLength: z.number().int().nonnegative().optional() }).optional(),
    probe: z.object({
      format: z.string().optional(), duration: z.number().nonnegative().optional(),
      tracks: z.array(z.object({
        kind: z.enum(["video", "audio", "other"]), codec: z.string().optional(), duration: z.number().nonnegative().optional(),
        firstPts: z.number().optional(), lastPts: z.number().optional(), width: z.number().int().nonnegative().optional(),
        height: z.number().int().nonnegative().optional(), frameRate: z.string().optional(), sampleRate: z.number().int().nonnegative().optional(), channels: z.number().int().nonnegative().optional(),
      })),
      fmp4: z.unknown().optional(),
    }).optional(),
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
  reportedContext: z.object({ approximateTimeSeconds: z.number().nonnegative().optional(), reportsVideoFreeze: z.boolean(), reportsAudioContinues: z.boolean(), reportsAbrSwitch: z.boolean(), reportsFourKToFullHd: z.boolean(), uncertainties: z.array(z.string()) }).optional(),
  dash: z.object({ type: z.enum(["static", "dynamic"]), representations: z.array(z.object({ id: z.string(), periodIndex: z.number().int().nonnegative(), adaptationSetIndex: z.number().int().nonnegative(), contentType: z.enum(["video", "audio", "unknown"]), codecs: z.string().optional(), bandwidth: z.number().nonnegative().optional(), width: z.number().int().nonnegative().optional(), height: z.number().int().nonnegative().optional(), frameRate: z.string().optional(), timescale: z.number().positive(), segmentAlignment: z.boolean().optional(), bitstreamSwitching: z.boolean().optional(), segmentCount: z.number().int().nonnegative() })), limitations: z.array(z.string()), analysis: z.unknown().optional() }).optional(),
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
  ai: z.object({
    available: z.boolean(), summary: z.string().optional(), likelyCause: z.string().optional(), confidence: z.number().min(0).max(1).optional(),
    findings: z.array(z.object({ title: z.string(), severity: z.enum(["info", "warning", "error"]), explanation: z.string(), evidenceIds: z.array(z.string()), confidence: z.number().min(0).max(1) })),
    recommendations: z.array(z.string()), limitations: z.array(z.string()),
    agents: z.array(z.object({ id: z.enum(["timeline-playback", "container-encoding", "manifest-delivery", "lead-investigator"]), state: z.enum(["completed", "failed", "unavailable"]), summary: z.string().optional(), limitation: z.string().optional() })),
  }).optional(),
});

const ManifestReportContentV1Schema = ManifestReportContentBaseSchema.extend({
  evidence: EvidenceBundleV1Schema,
  generatedBy: z.literal("deterministic-manifest-v1"),
});

const ManifestReportContentV2Schema = ManifestReportContentBaseSchema.extend({
  evidence: EvidenceBundleV2Schema,
  generatedBy: z.literal("deterministic-manifest-v2"),
});

const MediaReportContentSchema = ManifestReportContentBaseSchema.extend({
  evidence: EvidenceBundleV2Schema,
  generatedBy: z.literal("deterministic-media-v1"),
});

const PlaybackSessionSchema = z.object({
  id: z.string().uuid(), investigationId: z.string().uuid(), status: z.enum(["running", "completed", "failed", "expired"]),
  requestedDurationMs: z.number().int(), engine: z.enum(["hls.js", "native-hls"]).optional(), artifactId: z.string().uuid().optional(),
  createdAt: z.string(), finishedAt: z.string().optional(), errorCode: z.string().optional(), errorMessage: z.string().optional(),
});

const PlaybackReportContentSchema = ManifestReportContentBaseSchema.extend({
  evidence: EvidenceBundleV2Schema.extend({ schemaVersion: z.literal(3), playbackSessions: z.array(z.object({
    id: z.string().uuid(), engine: z.enum(["hls.js", "native-hls"]), startedAt: z.string(), finishedAt: z.string(), requestedDurationMs: z.number().int(), playedMs: z.number().int(), startupTimeMs: z.number().int().optional(), stalls: z.number().int(), stallDurationMs: z.number().int(), fragmentsLoaded: z.number().int(), qualitySwitches: z.number().int(), droppedFrames: z.number().int().optional(), errors: z.array(z.object({ type: z.string(), detail: z.string(), fatal: z.boolean(), atMs: z.number().int() })), limitations: z.array(z.string()),
  })).min(1) }),
  generatedBy: z.literal("deterministic-playback-v1"),
});

const InvestigationReportSchema = z.object({
  id: z.string().uuid(),
  investigationId: z.string().uuid(),
  schemaVersion: z.number().int().positive(),
  content: z.union([PhaseOneReportContentSchema, ManifestReportContentV1Schema, ManifestReportContentV2Schema, MediaReportContentSchema, PlaybackReportContentSchema]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Health = z.infer<typeof HealthSchema>;
export type Investigation = z.infer<typeof InvestigationSchema>;
export type InvestigationEvent = z.infer<typeof InvestigationEventSchema>;

const RecordingSchema = z.object({
  id: z.string().uuid(), sourceUrl: z.string().url(), protocol: z.literal("hls"),
  state: z.enum(["queued", "validating", "collecting", "ready", "failed"]),
  requestedDurationSeconds: z.number().int(), requestedStartSeconds: z.number().int(),
  coverageSeconds: z.number().optional(), totalBytes: z.number().optional(), errorCode: z.string().optional(), errorMessage: z.string().optional(),
  createdAt: z.string(), updatedAt: z.string(), completedAt: z.string().optional(),
});
export const RecordingEventSchema = z.object({ id: z.string().regex(/^\d+$/), recordingId: z.string().uuid(), type: z.string(), actor: z.string(), message: z.string(), payload: z.record(z.string(), z.unknown()), createdAt: z.string() });
const NetworkProfileSchema = z.object({ schemaVersion: z.literal(1), name: z.string(), stages: z.array(z.object({ afterVideoRequests: z.number(), bandwidthKbps: z.number(), latencyMs: z.number() })) });
const PlaybackRunSchema = z.object({ id: z.string().uuid(), recordingId: z.string().uuid(), state: z.enum(["created", "active", "completed", "expired", "failed"]), maxDurationSeconds: z.number(), profile: NetworkProfileSchema, createdAt: z.string(), expiresAt: z.string() });
export type Recording = z.infer<typeof RecordingSchema>;
export type RecordingEvent = z.infer<typeof RecordingEventSchema>;
const DeliveryRequestSchema = z.object({ id: z.string(), logicalPath: z.string(), resourceKind: z.string(), targetId: z.string().optional(), mediaSequence: z.number().optional(), variantBandwidth: z.number().optional(), variantResolution: z.string().optional(), stageIndex: z.number(), bandwidthKbps: z.number(), latencyMs: z.number(), bytesSent: z.number(), statusCode: z.number(), startedAt: z.string(), completedAt: z.string() });
export type DeliveryRequest = z.infer<typeof DeliveryRequestSchema>;
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

export async function startRecording(input: { url: string; durationSeconds: number; startSeconds: number }): Promise<{ recording: Recording; replayed: boolean }> {
  const response = await fetch("/v1/recordings", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify(input) });
  return parseResponse(response, z.object({ recording: RecordingSchema, replayed: z.boolean() }));
}
export async function getRecording(id: string): Promise<Recording> {
  const response = await fetch(`/v1/recordings/${encodeURIComponent(id)}`);
  return (await parseResponse(response, z.object({ recording: RecordingSchema }))).recording;
}
export async function createRecordingPlaybackRun(id: string): Promise<{ run: z.infer<typeof PlaybackRunSchema>; playbackUrl: string }> {
  const response = await fetch(`/v1/recordings/${encodeURIComponent(id)}/playback-runs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profile: { schemaVersion: 1, name: "Good → constrained → recovery", stages: [{ afterVideoRequests: 0, bandwidthKbps: 12000, latencyMs: 30 }, { afterVideoRequests: 3, bandwidthKbps: 1200, latencyMs: 200 }, { afterVideoRequests: 8, bandwidthKbps: 12000, latencyMs: 30 }] } }) });
  return parseResponse(response, z.object({ run: PlaybackRunSchema, playbackUrl: z.string() }));
}
export async function getRecordingRequests(recordingId: string, runId: string): Promise<DeliveryRequest[]> {
  const response = await fetch(`/v1/recordings/${encodeURIComponent(recordingId)}/playback-runs/${encodeURIComponent(runId)}/requests?limit=10`);
  return (await parseResponse(response, z.object({ requests: z.array(DeliveryRequestSchema) }))).requests;
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

export type PlaybackTelemetry = {
  engine: "hls.js" | "native-hls"; startedAt: string; finishedAt: string; requestedDurationMs: number; playedMs: number; startupTimeMs?: number; stalls: number; stallDurationMs: number; fragmentsLoaded: number; qualitySwitches: number; droppedFrames?: number; errors: Array<{ type: string; detail: string; fatal: boolean; atMs: number }>; limitations: string[];
};
export async function startPlaybackSession(id: string, requestedDurationMs = 30_000): Promise<{ session: z.infer<typeof PlaybackSessionSchema>; sourceUrl: string }> {
  const response = await fetch(`/v1/investigations/${encodeURIComponent(id)}/playback-sessions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestedDurationMs }) });
  return parseResponse(response, z.object({ session: PlaybackSessionSchema, sourceUrl: z.string().url() }));
}
export async function completePlaybackSession(id: string, sessionId: string, telemetry: PlaybackTelemetry): Promise<void> {
  const response = await fetch(`/v1/investigations/${encodeURIComponent(id)}/playback-sessions/${encodeURIComponent(sessionId)}/complete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(telemetry) });
  await parseResponse(response, z.object({ session: PlaybackSessionSchema }));
}
export async function failPlaybackSession(id: string, sessionId: string, code: string, message: string): Promise<void> {
  const response = await fetch(`/v1/investigations/${encodeURIComponent(id)}/playback-sessions/${encodeURIComponent(sessionId)}/fail`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, message }) });
  await parseResponse(response, z.object({ session: PlaybackSessionSchema }));
}
