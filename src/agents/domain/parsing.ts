import { z } from "zod";
import type { AiFinding, LeadOutput, SpecialistOutput } from "./types.js";

const LIMITED_CONFIDENCE = 0.2;
const ConfidenceSchema = z.preprocess(normalizeConfidence, z.number().min(0).max(1));
const SeveritySchema = z.preprocess(normalizeSeverity, z.enum(["info", "warning", "error"]));
const FindingSchema = z.object({
  title: z.string().trim().min(1),
  severity: SeveritySchema,
  explanation: z.string().trim().min(1),
  evidenceIds: z.preprocess(
    (value) => typeof value === "string" ? [value] : value,
    z.array(z.string().trim().min(1)),
  ),
  confidence: ConfidenceSchema,
});
const SpecialistEnvelopeSchema = z.object({
  summary: z.string().min(1),
  findings: z.array(z.unknown()).default([]),
  limitations: z.array(z.string()).default([]),
});
const LeadEnvelopeSchema = SpecialistEnvelopeSchema.extend({
  likelyCause: z.string().min(1),
  recommendations: z.array(z.string()).default([]),
  confidence: ConfidenceSchema,
});

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
  };
}

function parseFindings(values: unknown[]): AiFinding[] {
  return values.flatMap((value) => {
    const parsed = FindingSchema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  });
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
