import type { AbrAssessment, AbrAssessmentCategory, AbrAssessmentFinding, AbrReportedPriority, AbrRepresentation, AbrTransitionAssessment } from "../domain/assessment.js";
import type { AbrSeverity, AbrSwitchEvidence, AbrSwitchMatrixEntry } from "../domain/evidence.js";

export type BuildAbrAssessmentInput = {
  protocol: "hls" | "dash";
  representations: AbrRepresentation[];
  audioRenditionCount: number;
  mediaSampleCount: number;
  transitions?: AbrSwitchEvidence[];
  transitionMatrix?: AbrSwitchMatrixEntry[];
  reportedPriority?: AbrReportedPriority;
  coverageLimitations?: string[];
  playbackObserved?: boolean;
};

export function buildAbrAssessment(input: BuildAbrAssessmentInput): AbrAssessment {
  const representations = stableRepresentations(input.representations);
  const detailedTransitions = input.transitions ?? [];
  const transitionMatrix = input.transitionMatrix ?? [];
  const transitions = detailedTransitions.map((transition) => summarizeTransition(input.protocol, transition, transitionMatrix));
  const findings = evaluateLadder(representations);
  const transitionFindings = detailedTransitions.flatMap((transition) => transition.deterministicFindings);
  if (transitionFindings.some((finding) => finding.severity === "CRITICAL" || finding.severity === "HIGH")) {
    findings.push(finding(
      "ABR_TRANSITION_001",
      "TRANSITION_SAFETY",
      "HIGH",
      "At least one analyzed quality transition is unsafe or high risk",
      `${transitionFindings.filter((item) => item.severity === "CRITICAL" || item.severity === "HIGH").length} high-severity deterministic transition finding(s) were produced.`,
      transitionFindings.flatMap((item) => [item.evidenceId, ...item.evidenceIds]),
    ));
  }

  const representationCount = representations.length;
  const playbackObserved = input.playbackObserved ?? detailedTransitions.some((transition) => transition.evidenceBasis === "PLAYBACK_NETWORK_OBSERVED");
  const coverageLimitations = [
    ...(input.coverageLimitations ?? []),
    ...(representationCount > 1 && transitions.length === 0
      ? ["Transition safety was not measured between media representations in this run."]
      : []),
    ...(!playbackObserved
      ? ["No player request sequence was observed; ABR selection, decode and render behavior remain unmeasured."]
      : []),
  ];
  const verdict = assessmentVerdict(representationCount, findings, transitionFindings, input.mediaSampleCount);

  return {
    evidenceId: `abr-assessment:${input.protocol}`,
    schemaVersion: 1,
    protocol: input.protocol,
    verdict,
    reportedPriority: input.reportedPriority ?? { abrProblemReported: false },
    coverage: {
      level: playbackObserved ? "OBSERVED_PLAYBACK" : input.mediaSampleCount > 0 ? "SAMPLED_MEDIA" : "MANIFEST_ONLY",
      manifestObserved: true,
      mediaSampleCount: input.mediaSampleCount,
      representationCount,
      transitionPairsAnalyzed: transitions.length,
      playbackObserved,
      limitations: [...new Set(coverageLimitations)],
    },
    ladder: {
      representations,
      videoRepresentationCount: representationCount,
      audioRenditionCount: input.audioRenditionCount,
    },
    findings,
    transitions,
    transitionMatrix,
    recommendedMeasurements: recommendedMeasurements({ protocol: input.protocol, representationCount, transitions, playbackObserved, findings }),
  };
}

export function selectPriorityAbrTransition(assessment: AbrAssessment, candidates: AbrSwitchEvidence[]): AbrSwitchEvidence | undefined {
  const orderedByBandwidth = [...assessment.ladder.representations]
    .filter((representation) => representation.bandwidth !== undefined)
    .sort((left, right) => left.bandwidth! - right.bandwidth!);
  const rank = new Map(orderedByBandwidth.map((representation, index) => [representation.id, index]));
  const priority = assessment.reportedPriority;

  return [...candidates].sort((left, right) => {
    const scoreDelta = transitionScore(right, priority, rank) - transitionScore(left, priority, rank);
    return scoreDelta || left.switchId.localeCompare(right.switchId);
  })[0];
}

export function refreshAbrTransitionAssessment(assessment: AbrAssessment, detailed: AbrSwitchEvidence): void {
  const index = assessment.transitions.findIndex((transition) => transition.evidenceId === detailed.evidenceId);
  if (index < 0) return;
  assessment.transitions[index] = summarizeTransition(assessment.protocol, detailed, assessment.transitionMatrix);
}

function summarizeTransition(protocol: "hls" | "dash", transition: AbrSwitchEvidence, matrix: AbrSwitchMatrixEntry[]): AbrTransitionAssessment {
  const matrixEntry = matrix.find((entry) => entry.fromRepresentationId === transition.sourceRepresentation.id && entry.toRepresentationId === transition.targetRepresentation.id);
  const outcome = matrixEntry?.status ?? transitionOutcome(transition);
  return {
    evidenceId: transition.evidenceId,
    transitionId: transition.switchId,
    protocol,
    evidenceBasis: transition.evidenceBasis,
    transitionStatus: transition.transitionStatus,
    sourceRepresentation: toAssessmentRepresentation(protocol, transition.sourceRepresentation),
    targetRepresentation: toAssessmentRepresentation(protocol, transition.targetRepresentation),
    direction: transition.direction,
    switchKind: transition.switchKind,
    outcome,
    findingRuleIds: [...new Set(transition.deterministicFindings.map((finding) => finding.ruleId))],
  };
}

function toAssessmentRepresentation(protocol: "hls" | "dash", entry: AbrSwitchEvidence["sourceRepresentation"]): AbrRepresentation {
  return {
    evidenceId: entry.evidenceId,
    id: entry.id,
    groupId: protocol === "dash" ? `dash:p${entry.periodIndex}:a${entry.adaptationSetIndex}` : `${protocol}:video`,
    ...(entry.bandwidth === undefined ? {} : { bandwidth: entry.bandwidth }),
    ...(entry.width === undefined ? {} : { width: entry.width }),
    ...(entry.height === undefined ? {} : { height: entry.height }),
    ...(entry.codecs ? { codecs: entry.codecs } : {}),
  };
}

function transitionOutcome(transition: AbrSwitchEvidence): AbrTransitionAssessment["outcome"] {
  if (transition.deterministicFindings.some((finding) => finding.severity === "CRITICAL" || finding.severity === "HIGH")) return "FAIL";
  if (transition.decodeTests.some((test) => test.status === "FAIL")) return "FAIL";
  if (transition.deterministicFindings.length > 0) return "RISK";
  const executedDecodeTests = transition.decodeTests.filter((test) => test.status !== "NOT_RUN");
  return executedDecodeTests.length > 0 && executedDecodeTests.every((test) => test.status === "PASS") ? "PASS" : "NOT_TESTED";
}

function evaluateLadder(representations: AbrRepresentation[]): AbrAssessmentFinding[] {
  if (representations.length < 2) {
    return [finding(
      "ABR_LADDER_001",
      "COVERAGE",
      "INFO",
      "No multi-quality video ladder is available",
      representations.length === 0
        ? "The submitted manifest exposes no video variants or representations, so video ABR is not applicable to the observed topology."
        : "Only one video quality is exposed, so the player cannot adapt video quality within the observed topology.",
      representations.map((entry) => entry.evidenceId),
    )];
  }

  const findings: AbrAssessmentFinding[] = [];
  const missingBandwidth = representations.filter((entry) => entry.bandwidth === undefined || entry.bandwidth <= 0);
  if (missingBandwidth.length > 0) findings.push(finding(
    "ABR_LADDER_002",
    "LADDER_TOPOLOGY",
    "MEDIUM",
    "Some qualities have no usable declared bandwidth",
    `${missingBandwidth.length} of ${representations.length} video qualities cannot be reliably ordered by declared bandwidth.`,
    missingBandwidth.map((entry) => entry.evidenceId),
  ));

  for (const group of groupRepresentations(representations)) {
    const ordered = group.filter((entry) => entry.bandwidth !== undefined && entry.bandwidth > 0).sort((left, right) => left.bandwidth! - right.bandwidth!);
    for (let index = 1; index < ordered.length; index += 1) {
      const lower = ordered[index - 1]!;
      const higher = ordered[index]!;
      const ratio = higher.bandwidth! / lower.bandwidth!;
      if (resolutionArea(higher) > 0 && resolutionArea(lower) > 0 && resolutionArea(higher) < resolutionArea(lower)) findings.push(finding(
        "ABR_LADDER_003",
        "LADDER_CONSISTENCY",
        "HIGH",
        "Resolution decreases while declared bandwidth increases",
        `${higher.id} declares more bandwidth than ${lower.id} but a smaller coded resolution, which can make player quality ranking unstable.`,
        [lower.evidenceId, higher.evidenceId],
      ));
      if (ratio > 3) findings.push(finding(
        "ABR_LADDER_004",
        "LADDER_TOPOLOGY",
        "MEDIUM",
        "Large bitrate gap between adjacent qualities",
        `${lower.id} → ${higher.id} has a ${ratio.toFixed(2)}× declared-bandwidth step. Large gaps reduce the player's useful adaptation choices.`,
        [lower.evidenceId, higher.evidenceId],
      ));
      if (ratio < 1.08) findings.push(finding(
        "ABR_LADDER_005",
        "LADDER_TOPOLOGY",
        "LOW",
        "Adjacent qualities have nearly identical bandwidth",
        `${lower.id} and ${higher.id} differ by only ${Math.round((ratio - 1) * 100)}% in declared bandwidth; the extra rung may provide little adaptation value.`,
        [lower.evidenceId, higher.evidenceId],
      ));
    }

    const duplicateKeys = duplicateGroups(group, (entry) => `${entry.bandwidth ?? "?"}:${entry.width ?? "?"}x${entry.height ?? "?"}:${entry.codecs ?? "?"}`);
    for (const duplicates of duplicateKeys) findings.push(finding(
      "ABR_LADDER_006",
      "LADDER_TOPOLOGY",
      "LOW",
      "Duplicate quality descriptors in the ladder",
      `${duplicates.map((entry) => entry.id).join(", ")} expose the same bandwidth, resolution and codec descriptors.`,
      duplicates.map((entry) => entry.evidenceId),
    ));

    const codecFamilies = new Set(group.flatMap((entry) => codecFamily(entry.codecs) ? [codecFamily(entry.codecs)!] : []));
    if (codecFamilies.size > 1) findings.push(finding(
      "ABR_LADDER_007",
      "LADDER_CONSISTENCY",
      "MEDIUM",
      "A switching group mixes codec families",
      `The group exposes ${[...codecFamilies].join(", ")}; seamless switching depends on player support and may require a decoder change.`,
      group.map((entry) => entry.evidenceId),
    ));
  }
  return findings;
}

function assessmentVerdict(representationCount: number, findings: AbrAssessmentFinding[], transitionFindings: AbrSwitchEvidence["deterministicFindings"], mediaSampleCount: number): AbrAssessment["verdict"] {
  if (representationCount < 2) return "NOT_APPLICABLE";
  if (findings.some((item) => item.severity === "CRITICAL" || item.severity === "HIGH" || item.severity === "MEDIUM") || transitionFindings.some((item) => item.severity === "CRITICAL" || item.severity === "HIGH")) return "ISSUES_FOUND";
  if (mediaSampleCount === 0) return "INCONCLUSIVE";
  return "NO_ISSUE_DETECTED";
}

function recommendedMeasurements(input: { protocol: "hls" | "dash"; representationCount: number; transitions: AbrTransitionAssessment[]; playbackObserved: boolean; findings: AbrAssessmentFinding[] }): string[] {
  if (input.representationCount < 2) return ["Provide a master manifest with at least two video qualities to evaluate video ABR behavior."];
  const values: string[] = [];
  if (input.protocol === "hls" && input.transitions.length === 0) values.push("Collect aligned media windows from at least two HLS variants and compare segment boundaries, codecs and timestamps.");
  if (input.protocol === "dash" && input.transitions.length === 0) values.push("Collect INIT and aligned fragments from adjacent DASH representations to evaluate transition safety.");
  if (!input.playbackObserved) values.push("Run the recording under a controlled network profile to measure selections, switch latency, recovery and oscillation at request level.");
  if (input.findings.some((finding) => finding.category === "LADDER_TOPOLOGY")) values.push("Review the encoding ladder against content complexity and expected network/device populations.");
  return [...new Set(values)];
}

function transitionScore(transition: AbrSwitchEvidence, priority: AbrReportedPriority, rank: Map<string, number>): number {
  const severity = { INFO: 1, LOW: 3, MEDIUM: 10, HIGH: 30, CRITICAL: 80 } as const;
  let score = transition.deterministicFindings.reduce((total, finding) => total + severity[finding.severity], 0);
  if (priority.direction && transition.direction === priority.direction) score += 40;
  if (priority.sourceHeight !== undefined && transition.sourceRepresentation.height !== undefined) score += Math.max(0, 30 - Math.abs(priority.sourceHeight - transition.sourceRepresentation.height) / 20);
  if (priority.targetHeight !== undefined && transition.targetRepresentation.height !== undefined) score += Math.max(0, 30 - Math.abs(priority.targetHeight - transition.targetRepresentation.height) / 20);
  if (priority.approximateTimeSeconds !== undefined && transition.timestamps.candidateBoundaryPresentationTimeMs !== undefined) score += Math.max(0, 20 - Math.abs(priority.approximateTimeSeconds * 1_000 - transition.timestamps.candidateBoundaryPresentationTimeMs) / 1_000);
  const sourceRank = rank.get(transition.sourceRepresentation.id);
  const targetRank = rank.get(transition.targetRepresentation.id);
  if (sourceRank !== undefined && targetRank !== undefined && Math.abs(sourceRank - targetRank) === 1) score += 15;
  score += transition.initSemanticDiff ? 3 : 0;
  score += transition.timelineEvidence ? 3 : 0;
  return score;
}

function stableRepresentations(representations: AbrRepresentation[]): AbrRepresentation[] {
  return [...new Map(representations.map((entry) => [`${entry.groupId}:${entry.id}`, entry])).values()]
    .sort((left, right) => left.groupId.localeCompare(right.groupId) || (left.bandwidth ?? 0) - (right.bandwidth ?? 0) || left.id.localeCompare(right.id));
}

function groupRepresentations(representations: AbrRepresentation[]): AbrRepresentation[][] {
  const groups = new Map<string, AbrRepresentation[]>();
  for (const representation of representations) groups.set(representation.groupId, [...(groups.get(representation.groupId) ?? []), representation]);
  return [...groups.values()];
}

function duplicateGroups(representations: AbrRepresentation[], key: (entry: AbrRepresentation) => string): AbrRepresentation[][] {
  const groups = new Map<string, AbrRepresentation[]>();
  for (const representation of representations) groups.set(key(representation), [...(groups.get(key(representation)) ?? []), representation]);
  return [...groups.values()].filter((entries) => entries.length > 1);
}

function resolutionArea(entry: AbrRepresentation): number { return (entry.width ?? 0) * (entry.height ?? 0); }
function codecFamily(codecs: string | undefined): string | undefined { const value = codecs?.split(",")[0]?.trim().toLowerCase(); if (!value) return undefined; if (/^(?:avc1|avc3|h264)/.test(value)) return "H264"; if (/^(?:hvc1|hev1|hevc)/.test(value)) return "HEVC"; if (/^(?:av01|av1)/.test(value)) return "AV1"; if (/^(?:vp09|vp9)/.test(value)) return "VP9"; return value.split(".")[0]?.toUpperCase(); }
function finding(ruleId: string, category: AbrAssessmentCategory, severity: AbrSeverity, title: string, explanation: string, evidenceIds: string[]): AbrAssessmentFinding { return { evidenceId: `finding:abr-assessment:${ruleId}:${evidenceIds.join("|") || "stream"}`, ruleId, category, severity, title, explanation, evidenceIds: [...new Set(evidenceIds)] }; }
