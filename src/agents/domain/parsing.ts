import { z } from "zod";
import type { AiFinding, LeadOutput, SpecialistOutput } from "./types.js";

const LIMITED_CONFIDENCE = 0.2;
const ConfidenceSchema = z.preprocess(normalizeConfidence, z.number().min(0).max(1));
const SeveritySchema = z.preprocess(normalizeSeverity, z.enum(["info", "warning", "error"]));
const StringListSchema = z.preprocess(normalizeStringList, z.array(z.string().trim().min(1))).default([]);
const FindingSchema = z.preprocess(normalizeFinding, z.object({
  title: z.string().trim().min(1),
  severity: SeveritySchema,
  explanation: z.string().trim().min(1),
  evidenceIds: z.preprocess(
    (value) => typeof value === "string" ? [value] : value,
    z.array(z.string().trim().min(1)),
  ),
  confidence: ConfidenceSchema,
}));
const SpecialistEnvelopeSchema = z.preprocess(normalizeSpecialistEnvelope, z.object({
  summary: z.string().trim().min(1),
  findings: z.array(z.unknown()).default([]),
  limitations: StringListSchema,
}));
const LeadEnvelopeSchema = z.preprocess(normalizeLeadEnvelope, z.object({
  summary: z.string().trim().min(1),
  findings: z.array(z.unknown()).default([]),
  limitations: StringListSchema,
  likelyCause: z.string().trim().min(1),
  recommendations: StringListSchema,
  confidence: ConfidenceSchema,
  validationPlan: z.object({
    goal: z.string().trim().min(3).max(2_000),
    hypothesis: z.string().trim().min(3).max(1_000),
    rationale: z.string().trim().min(1).max(2_000),
    proofBoundary: z.string().trim().min(1).max(1_000),
    treatment: z.object({
      recipe: z.enum(["single_video_representation", "representation_subset", "single_audio"]),
      shortLabel: z.string().trim().min(1).max(24).regex(/^[A-Za-z0-9-]+$/),
      representationIds: z.array(z.string().trim().min(1).max(120)).max(32).default([]),
    }),
  }).nullable().optional(),
}));

export function parseSpecialistOutput(value: unknown): SpecialistOutput {
  const output = SpecialistEnvelopeSchema.parse(value);
  return {
    summary: output.summary,
    findings: parseFindings(output.findings),
    limitations: output.limitations,
  };
}

export function parseLeadOutput(value: unknown): LeadOutput {
  const output = LeadEnvelopeSchema.parse(value);
  return {
    summary: output.summary,
    likelyCause: output.likelyCause,
    confidence: output.confidence,
    findings: parseFindings(output.findings),
    recommendations: output.recommendations,
    limitations: output.limitations,
    ...(output.validationPlan ? { validationPlan: output.validationPlan } : {}),
  };
}

function parseFindings(values: unknown[]): AiFinding[] {
  return values.flatMap((value) => {
    const parsed = FindingSchema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  });
}

function normalizeSpecialistEnvelope(value: unknown): unknown {
  const record = unwrapEnvelope(value);
  if (!record) return value;
  return {
    ...record,
    summary: firstString(record.summary, record.analysis_summary, record.overview, record.conclusion),
    findings: record.findings ?? record.observations ?? [],
    limitations: record.limitations ?? record.missing_evidence ?? record.missingEvidence ?? [],
  };
}

function normalizeLeadEnvelope(value: unknown): unknown {
  const normalized = normalizeSpecialistEnvelope(value);
  const record = asRecord(normalized);
  if (!record) return normalized;
  const strongestHypothesis = asRecord(record.strongest_hypothesis ?? record.strongestHypothesis);
  return {
    ...record,
    likelyCause: firstString(
      record.likelyCause,
      record.likely_cause,
      record.rootCause,
      record.root_cause,
      strongestHypothesis?.statement,
    ),
    recommendations: record.recommendations ?? record.recommended_actions ?? record.next_steps ?? [],
    validationPlan: normalizeValidationPlan(record.validationPlan ?? record.validation_plan ?? record.nextExperiment ?? record.next_experiment),
  };
}

function normalizeValidationPlan(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  const record = asRecord(value);
  if (!record) return value;
  const treatment = asRecord(record.treatment);
  return {
    ...record,
    goal: firstString(record.goal, record.objective),
    hypothesis: firstString(record.hypothesis, record.statement),
    rationale: firstString(record.rationale, record.reason),
    proofBoundary: firstString(record.proofBoundary, record.proof_boundary, record.canProve, record.can_prove),
    treatment: treatment ? {
      ...treatment,
      recipe: firstString(treatment.recipe, treatment.type),
      shortLabel: firstString(treatment.shortLabel, treatment.short_label, treatment.label),
      representationIds: normalizeStringList(treatment.representationIds ?? treatment.representation_ids),
    } : treatment,
  };
}

function normalizeFinding(value: unknown): unknown {
  const record = asRecord(value);
  if (!record) return value;
  return {
    ...record,
    title: firstString(record.title, record.name, record.rule_id, record.category),
    severity: record.severity ?? record.level,
    explanation: firstString(
      record.explanation,
      record.technical_explanation,
      record.description,
      record.statement,
    ),
    evidenceIds: record.evidenceIds ?? record.evidence_ids ?? record.citations ?? record.evidence,
    confidence: record.confidence,
  };
}

function unwrapEnvelope(value: unknown): Record<string, unknown> | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  if (["summary", "analysis_summary", "findings", "likelyCause", "likely_cause"].some((key) => key in record)) {
    return record;
  }
  for (const key of ["output", "result", "analysis", "response"]) {
    const nested = asRecord(record[key]);
    if (nested) return nested;
  }
  const nestedRecords = Object.values(record).flatMap((entry) => {
    const nested = asRecord(entry);
    return nested ? [nested] : [];
  });
  return nestedRecords.length === 1 ? nestedRecords[0] : record;
}

function normalizeStringList(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return values.flatMap((entry) => {
    if (typeof entry === "string") return entry.trim() ? [entry] : [];
    const record = asRecord(entry);
    const text = record ? firstString(record.message, record.description, record.text, record.title) : undefined;
    return text ? [text] : [];
  });
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim();
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function normalizeConfidence(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 && value <= 1 ? value : LIMITED_CONFIDENCE;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : LIMITED_CONFIDENCE;
  }
  return LIMITED_CONFIDENCE;
}

function normalizeSeverity(value: unknown): "info" | "warning" | "error" {
  if (typeof value !== "string") return "info";
  const normalized = value.trim().toLowerCase();
  if (["error", "critical", "high"].includes(normalized)) return "error";
  if (["warning", "warn", "medium"].includes(normalized)) return "warning";
  return "info";
}
