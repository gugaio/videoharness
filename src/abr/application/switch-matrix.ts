import type { AbrSwitchEvidence, AbrSwitchMatrixEntry, RepresentationSummary } from "../domain/evidence.js";

export function buildAbrSwitchMatrix(representations: RepresentationSummary[], switches: AbrSwitchEvidence[]): AbrSwitchMatrixEntry[] {
  const ordered = [...representations].sort((left, right) => (right.height ?? 0) - (left.height ?? 0) || (right.bandwidth ?? 0) - (left.bandwidth ?? 0));
  return ordered.flatMap((source) => ordered.filter((target) => target.id !== source.id).map((target) => {
    const observed = switches.filter((item) => item.sourceRepresentation.id === source.id && item.targetRepresentation.id === target.id);
    const findings = observed.flatMap((item) => item.deterministicFindings);
    const fail = findings.some((finding) => finding.severity === "CRITICAL" || finding.category === "SPEC_VIOLATION" || finding.category === "AUTHORING_ERROR");
    const risk = findings.some((finding) => finding.category === "DECODER_RECONFIGURATION_RISK" || finding.category === "DEVICE_COMPATIBILITY_RISK" || finding.category === "PLATFORM_SUSPECTED");
    return {
      fromRepresentationId: source.id,
      toRepresentationId: target.id,
      switchKind: resolutionKind(source, target),
      status: observed.length === 0 ? "NOT_TESTED" : fail ? "FAIL" : risk ? "RISK" : "PASS",
      findingRuleIds: [...new Set(findings.map((finding) => finding.ruleId))],
    };
  }));
}

export function reconfigurationSensitivitySummary(matrix: AbrSwitchMatrixEntry[]): string | undefined {
  const sameResolution = matrix.filter((entry) => entry.switchKind === "SAME_RESOLUTION_BITRATE" && entry.status !== "NOT_TESTED");
  const resolutionChanging = matrix.filter((entry) => entry.switchKind === "RESOLUTION_CHANGING" && entry.status !== "NOT_TESTED");
  if (sameResolution.length > 0 && sameResolution.every((entry) => entry.status === "PASS") && resolutionChanging.some((entry) => entry.status === "FAIL")) return "Same-resolution bitrate switches pass while resolution-changing switches fail; this is strong evidence of decoder reconfiguration sensitivity.";
  return undefined;
}

function resolutionKind(source: RepresentationSummary, target: RepresentationSummary): AbrSwitchEvidence["switchKind"] { return source.width === undefined || source.height === undefined || target.width === undefined || target.height === undefined ? "UNKNOWN" : source.width === target.width && source.height === target.height ? "SAME_RESOLUTION_BITRATE" : "RESOLUTION_CHANGING"; }
