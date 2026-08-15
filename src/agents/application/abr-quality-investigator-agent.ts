import { z } from "zod";
import { selectPriorityAbrTransition } from "../../abr/application/assess-stream-abr.js";
import type { AbrAssessment } from "../../abr/domain/assessment.js";
import type { AbrSwitchEvidence } from "../../abr/domain/evidence.js";
import { ABR_QUALITY_INVESTIGATOR_SYSTEM_PROMPT } from "../domain/prompts.js";
import type { AgentModelRunner } from "../ports/agent-model-runner.js";

const CATEGORIES = ["LADDER_TOPOLOGY", "LADDER_CONSISTENCY", "TRANSITION_SAFETY", "SPEC_VIOLATION", "AUTHORING_ERROR", "AUTHORING_RISK", "DECODER_RECONFIGURATION_RISK", "DEVICE_CAPABILITY_MISMATCH", "DEVICE_COMPATIBILITY_RISK", "DRM_TRANSITION", "NETWORK_OR_DELIVERY", "PLATFORM_SUSPECTED", "COVERAGE", "INCONCLUSIVE"] as const;
const CONFIDENCE_LEVELS = ["LOW", "MEDIUM", "HIGH", "VERY_HIGH"] as const;
const SEVERITIES = ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
const CategorySchema = z.preprocess(normalizeCategory, z.enum(CATEGORIES));
const ConfidenceSchema = z.preprocess(normalizeAbrConfidence, z.enum(CONFIDENCE_LEVELS));
const SeveritySchema = z.preprocess(normalizeAbrSeverity, z.enum(SEVERITIES));
const TextSchema = z.preprocess(normalizeText, z.string());
const StringListSchema = z.preprocess(normalizeStringList, z.array(z.string()));
const StrongestHypothesisSchema = z.preprocess(normalizeStrongestHypothesis, z.object({
  category: CategorySchema,
  confidence: ConfidenceSchema,
  statement: z.string().trim().min(1),
  evidence_ids: StringListSchema,
}));
const AbrFindingSchema = z.preprocess(normalizeAbrFinding, z.object({
  rule_id: z.string().trim().min(1),
  category: CategorySchema,
  severity: SeveritySchema,
  confidence: ConfidenceSchema,
  title: z.string().trim().min(1),
  evidence_ids: StringListSchema,
  from_representation: z.string().optional(),
  to_representation: z.string().optional(),
  technical_explanation: TextSchema,
  why_this_affects_abr: TextSchema,
  why_this_can_affect_player: TextSchema,
  spec_or_contract: TextSchema,
  confirmatory_test: TextSchema,
  recommended_remediation: TextSchema,
}));
const OutputEnvelopeSchema = z.preprocess(normalizeAbrEnvelope, z.object({
  assessment_id: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  abr_quality_explained: TextSchema,
  strongest_hypothesis: StrongestHypothesisSchema,
  findings: z.array(z.unknown()),
  ruled_out_or_weakened_hypotheses: StringListSchema,
  missing_evidence: StringListSchema,
  recommended_measurements: StringListSchema,
  next_best_experiment: TextSchema,
}));

type AbrQualityEnvelope = z.infer<typeof OutputEnvelopeSchema>;
type AbrQualityFinding = z.infer<typeof AbrFindingSchema>;
export type AbrQualityAgentOutput = Omit<AbrQualityEnvelope, "findings"> & { findings: AbrQualityFinding[] };
export function parseAbrQualityAgentOutput(value: unknown): AbrQualityAgentOutput {
  const output = OutputEnvelopeSchema.parse(value);
  return {
    ...output,
    findings: output.findings.flatMap((finding) => {
      const parsed = AbrFindingSchema.safeParse(finding);
      return parsed.success ? [parsed.data] : [];
    }),
  };
}

function normalizeAbrEnvelope(value: unknown): unknown {
  const record = unwrapEnvelope(value);
  if (!record) return value;
  return {
    ...record,
    assessment_id: firstString(record.assessment_id, record.assessmentId) ?? "abr-assessment:unspecified",
    summary: firstString(record.summary, record.analysis_summary, record.overview, record.conclusion),
    abr_quality_explained: record.abr_quality_explained ?? record.abrQualityExplained,
    strongest_hypothesis: record.strongest_hypothesis ?? record.strongestHypothesis,
    findings: Array.isArray(record.findings) ? record.findings : [],
    ruled_out_or_weakened_hypotheses: record.ruled_out_or_weakened_hypotheses ?? record.ruledOutOrWeakenedHypotheses,
    missing_evidence: record.missing_evidence ?? record.missingEvidence,
    recommended_measurements: record.recommended_measurements ?? record.recommendedMeasurements,
    next_best_experiment: record.next_best_experiment ?? record.nextBestExperiment,
  };
}

function normalizeStrongestHypothesis(value: unknown): unknown {
  const record = asRecord(value) ?? {};
  return {
    ...record,
    category: record.category,
    confidence: record.confidence,
    statement: firstString(record.statement, record.hypothesis, record.summary) ?? "No supported ABR hypothesis was returned.",
    evidence_ids: record.evidence_ids ?? record.evidenceIds,
  };
}

function normalizeAbrFinding(value: unknown): unknown {
  const record = asRecord(value);
  if (!record) return value;
  const title = firstString(record.title, record.rule_id, record.ruleId, record.category);
  return {
    ...record,
    rule_id: firstString(record.rule_id, record.ruleId, title) ?? "AI_ABR_UNCLASSIFIED",
    category: record.category,
    severity: record.severity,
    confidence: record.confidence,
    title: title ?? "ABR observation",
    evidence_ids: record.evidence_ids ?? record.evidenceIds ?? record.citations,
    from_representation: firstString(record.from_representation, record.fromRepresentation),
    to_representation: firstString(record.to_representation, record.toRepresentation),
    technical_explanation: record.technical_explanation ?? record.technicalExplanation ?? record.explanation,
    why_this_affects_abr: record.why_this_affects_abr ?? record.whyThisAffectsAbr,
    why_this_can_affect_player: record.why_this_can_affect_player ?? record.whyThisCanAffectPlayer,
    spec_or_contract: record.spec_or_contract ?? record.specOrContract,
    confirmatory_test: record.confirmatory_test ?? record.confirmatoryTest,
    recommended_remediation: record.recommended_remediation ?? record.recommendedRemediation,
  };
}

function normalizeCategory(value: unknown): (typeof CATEGORIES)[number] {
  const normalized = normalizeLabel(value);
  return CATEGORIES.find((entry) => entry === normalized) ?? "INCONCLUSIVE";
}

function normalizeAbrConfidence(value: unknown): (typeof CONFIDENCE_LEVELS)[number] {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value >= 0.85) return "VERY_HIGH";
    if (value >= 0.65) return "HIGH";
    if (value >= 0.35) return "MEDIUM";
    return "LOW";
  }
  const normalized = normalizeLabel(value);
  return CONFIDENCE_LEVELS.find((entry) => entry === normalized) ?? "LOW";
}

function normalizeAbrSeverity(value: unknown): (typeof SEVERITIES)[number] {
  const normalized = normalizeLabel(value);
  return SEVERITIES.find((entry) => entry === normalized) ?? "INFO";
}

function normalizeLabel(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase().replace(/[\s-]+/g, "_") : "";
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringList(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return values.flatMap((entry) => typeof entry === "string" && entry.trim() ? [entry.trim()] : []);
}

function unwrapEnvelope(value: unknown): Record<string, unknown> | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  if (["summary", "analysis_summary", "assessment_id", "assessmentId", "findings"].some((key) => key in record)) return record;
  for (const key of ["output", "result", "analysis", "response"]) {
    const nested = asRecord(record[key]);
    if (nested) return nested;
  }
  return record;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim();
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export class ABRQualityInvestigatorAgent {
  constructor(private readonly runModel: AgentModelRunner) {}

  async investigate(input: { investigationId: string; assessment: AbrAssessment; detailedTransitions?: AbrSwitchEvidence[]; tools?: readonly unknown[] }): Promise<AbrQualityAgentOutput> {
    const detailedTransitions = input.detailedTransitions ?? [];
    const validEvidenceIds = collectEvidenceIds(input.assessment, detailedTransitions);
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const raw = await this.runModel({
          investigationId: input.investigationId,
          agentId: "abr-switch-investigator",
          systemPrompt: ABR_QUALITY_INVESTIGATOR_SYSTEM_PROMPT,
          prompt: JSON.stringify(buildAbrQualityAgentPacket(input.assessment, detailedTransitions)) + (attempt === 0 ? "" : "\nCorrija o contrato e retorne somente o JSON exigido."),
          tools: input.tools ?? [],
        });
        return enforceEvidenceCitations(parseAbrQualityAgentOutput(raw), validEvidenceIds);
      } catch (error) { lastError = error; }
    }
    throw lastError;
  }
}

export function buildAbrQualityAgentPacket(assessment: AbrAssessment, detailedTransitions: AbrSwitchEvidence[] = []): object {
  const priorityTransition = selectPriorityAbrTransition(assessment, detailedTransitions);
  return {
    assessment_id: assessment.evidenceId,
    protocol: assessment.protocol,
    verdict: assessment.verdict,
    reported_priority: assessment.reportedPriority,
    coverage: assessment.coverage,
    ladder: assessment.ladder,
    deterministic_assessment_findings: assessment.findings,
    transition_matrix: assessment.transitionMatrix,
    priority_transition: priorityTransition ? compactTransition(priorityTransition) : null,
    other_transition_summaries: assessment.transitions.filter((entry) => entry.transitionId !== priorityTransition?.switchId),
    recommended_measurements: assessment.recommendedMeasurements,
  };
}

function compactTransition(evidence: AbrSwitchEvidence): object {
  return {
    evidence_basis: evidence.evidenceBasis,
    transition_status: evidence.transitionStatus,
    reported_player_context: evidence.reportedPlayerContext,
    session_device_summary: evidence.deviceCapabilityEvidence,
    switch_id: evidence.switchId,
    timestamps: evidence.timestamps,
    switching_contract: evidence.switchingContract,
    source_representation: evidence.sourceRepresentation,
    target_representation: evidence.targetRepresentation,
    switch_direction: evidence.direction,
    switch_kind: evidence.switchKind,
    init_semantic_diff: evidence.initSemanticDiff,
    normalized_timeline_boundary: evidence.timelineEvidence,
    sap_evidence: evidence.sapEvidence,
    codec_diff: evidence.codecDiff,
    drm_diff: evidence.drmDiff,
    deterministic_rule_findings: evidence.deterministicFindings,
    player_event_timeline: evidence.playerEvidence,
    http_completion_summary: {
      evidenceId: evidence.networkEvidence.evidenceId,
      targetInitCompletedBeforeSymptom: evidence.networkEvidence.targetInitCompletedBeforeSymptom,
      targetMediaCompletedBeforeSymptom: evidence.networkEvidence.targetMediaCompletedBeforeSymptom,
      requests: evidence.networkEvidence.requests.map(({ url: _url, responseHeaders: _responseHeaders, ...request }) => request),
    },
    decode_test_summary: evidence.decodeTests,
    conformance_validator_summary: evidence.conformance,
    boundary_only_packet_frame_nal_evidence: { source: evidence.sourceBoundary, target: evidence.targetBoundary },
    missing_evidence: evidence.missingEvidence,
  };
}

function enforceEvidenceCitations(output: AbrQualityAgentOutput, valid: Set<string>): AbrQualityAgentOutput {
  const findings = output.findings.map((finding) => ({ ...finding, evidence_ids: finding.evidence_ids.filter((id) => valid.has(id)) })).filter((finding) => finding.evidence_ids.length > 0);
  const strongestIds = output.strongest_hypothesis.evidence_ids.filter((id) => valid.has(id));
  const strongest = strongestIds.length > 0 || output.strongest_hypothesis.category === "INCONCLUSIVE"
    ? { ...output.strongest_hypothesis, evidence_ids: strongestIds }
    : { category: "INCONCLUSIVE" as const, confidence: "LOW" as const, statement: "A hipótese principal não possuía evidence_ids válidos; a evidência é inconclusiva.", evidence_ids: [] };
  return { ...output, strongest_hypothesis: strongest, findings };
}

function collectEvidenceIds(assessment: AbrAssessment, detailedTransitions: AbrSwitchEvidence[]): Set<string> {
  return new Set([
    assessment.evidenceId,
    ...assessment.ladder.representations.map((entry) => entry.evidenceId),
    ...assessment.findings.flatMap((entry) => [entry.evidenceId, ...entry.evidenceIds]),
    ...assessment.transitions.flatMap((entry) => [entry.evidenceId, entry.sourceRepresentation.evidenceId, entry.targetRepresentation.evidenceId]),
    ...detailedTransitions.flatMap(transitionEvidenceIds),
  ]);
}

function transitionEvidenceIds(evidence: AbrSwitchEvidence): string[] {
  return [
    evidence.evidenceId, evidence.sourceRepresentation.evidenceId, evidence.targetRepresentation.evidenceId, evidence.switchingContract.evidenceId,
    evidence.networkEvidence.evidenceId, ...evidence.networkEvidence.requests.map((item) => item.evidenceId),
    ...optionalId(evidence.reportedPlayerContext),
    ...(evidence.playerEvidence ? [evidence.playerEvidence.evidenceId, ...evidence.playerEvidence.events.map((item) => item.evidenceId)] : []),
    ...optionalId(evidence.sourceInit), ...optionalId(evidence.targetInit), ...optionalId(evidence.initSemanticDiff), ...optionalId(evidence.codecDiff), ...optionalId(evidence.drmDiff),
    ...boundaryIds(evidence.sourceBoundary), ...boundaryIds(evidence.targetBoundary), ...optionalId(evidence.sapEvidence), ...optionalId(evidence.timelineEvidence), ...optionalId(evidence.deviceCapabilityEvidence),
    ...evidence.decodeTests.map((item) => item.evidenceId), ...optionalId(evidence.conformance), ...evidence.deterministicFindings.flatMap((item) => [item.evidenceId, ...item.evidenceIds]),
  ];
}
function optionalId(value: { evidenceId: string } | undefined): string[] { return value ? [value.evidenceId] : []; }
function boundaryIds(value: AbrSwitchEvidence["targetBoundary"]): string[] { return value ? [value.evidenceId, ...value.accessUnits.map((item) => item.evidenceId)] : []; }
