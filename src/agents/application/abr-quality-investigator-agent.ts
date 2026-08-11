import { z } from "zod";
import { selectPriorityAbrTransition } from "../../abr/application/assess-stream-abr.js";
import type { AbrAssessment } from "../../abr/domain/assessment.js";
import type { AbrSwitchEvidence } from "../../abr/domain/evidence.js";
import { ABR_QUALITY_INVESTIGATOR_SYSTEM_PROMPT } from "../domain/prompts.js";
import type { AgentModelRunner } from "../ports/agent-model-runner.js";

const CategorySchema = z.enum(["LADDER_TOPOLOGY", "LADDER_CONSISTENCY", "TRANSITION_SAFETY", "SPEC_VIOLATION", "AUTHORING_ERROR", "AUTHORING_RISK", "DECODER_RECONFIGURATION_RISK", "DEVICE_CAPABILITY_MISMATCH", "DEVICE_COMPATIBILITY_RISK", "DRM_TRANSITION", "NETWORK_OR_DELIVERY", "PLATFORM_SUSPECTED", "COVERAGE", "INCONCLUSIVE"]);
const ConfidenceSchema = z.enum(["LOW", "MEDIUM", "HIGH", "VERY_HIGH"]);
const SeveritySchema = z.enum(["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]);
const OutputSchema = z.object({
  assessment_id: z.string().min(1),
  summary: z.string().min(1),
  abr_quality_explained: z.string(),
  strongest_hypothesis: z.object({ category: CategorySchema, confidence: ConfidenceSchema, statement: z.string().min(1), evidence_ids: z.array(z.string()) }),
  findings: z.array(z.object({
    rule_id: z.string().min(1), category: CategorySchema, severity: SeveritySchema, confidence: ConfidenceSchema, title: z.string().min(1), evidence_ids: z.array(z.string()),
    from_representation: z.string().optional(), to_representation: z.string().optional(), technical_explanation: z.string(), why_this_affects_abr: z.string(), why_this_can_affect_player: z.string(), spec_or_contract: z.string(), confirmatory_test: z.string(), recommended_remediation: z.string(),
  })),
  ruled_out_or_weakened_hypotheses: z.array(z.string()),
  missing_evidence: z.array(z.string()),
  recommended_measurements: z.array(z.string()),
  next_best_experiment: z.string(),
});

export type AbrQualityAgentOutput = z.infer<typeof OutputSchema>;
export function parseAbrQualityAgentOutput(value: unknown): AbrQualityAgentOutput { return OutputSchema.parse(value); }

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
