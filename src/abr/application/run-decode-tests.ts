import type { EvidenceBundleV2 } from "../../investigation/domain/evidence.js";
import type { MediaSample } from "../../investigation/ports/media-sample-collector.js";
import type { AbrDecodeTester } from "../ports/abr-decode-tester.js";
import type { AbrSwitchEvidence } from "../domain/evidence.js";
import { refreshAbrTransitionAssessment, selectPriorityAbrTransition } from "./assess-stream-abr.js";

/** Runs bounded decode checks for the most relevant URL-only DASH candidate. */
export async function attachPriorityAbrDecodeTests(evidence: EvidenceBundleV2, samples: MediaSample[], tester: AbrDecodeTester): Promise<void> {
  const candidates = evidence.dash?.switches ?? [];
  const candidate = evidence.abr ? selectPriorityAbrTransition(evidence.abr, candidates) : legacyPriorityCandidate(candidates);
  if (!candidate) return;
  const sourceInit = initFor(samples, candidate.sourceRepresentation.id);
  const targetInit = initFor(samples, candidate.targetRepresentation.id);
  const sourceFragments = fragmentsFor(samples, candidate.sourceRepresentation.id, candidate.sourceBoundary?.segmentNumber, "source");
  const targetFragments = fragmentsFor(samples, candidate.targetRepresentation.id, candidate.targetBoundary?.segmentNumber, "target");
  if (!sourceInit || !targetInit || sourceFragments.length === 0 || targetFragments.length === 0) return;
  candidate.decodeTests = await tester.run({ switchId: candidate.switchId, sourceInit: sourceInit.content.bytes, sourceFragments: sourceFragments.map((item) => item.content.bytes), targetInit: targetInit.content.bytes, targetFragments: targetFragments.map((item) => item.content.bytes), bitstreamSwitchingAllowed: candidate.switchingContract.bitstreamSwitching === true });
  candidate.missingEvidence = candidate.missingEvidence.filter((item) => item !== "standalone and switching decode tests");
  if (evidence.abr) refreshAbrTransitionAssessment(evidence.abr, candidate);
}

function legacyPriorityCandidate(switches: AbrSwitchEvidence[]): AbrSwitchEvidence | undefined { return switches.find((entry) => entry.deterministicFindings.some((finding) => finding.severity === "CRITICAL" || finding.severity === "HIGH")) ?? switches[0]; }
function initFor(samples: MediaSample[], representationId: string): MediaSample | undefined { return samples.find((item) => item.kind === "init-segment" && item.representationId === representationId); }
function fragmentsFor(samples: MediaSample[], representationId: string, boundarySequence: number | undefined, side: "source" | "target"): MediaSample[] { const ordered = samples.filter((item) => item.kind === "media-segment" && item.representationId === representationId).sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0)); if (boundarySequence === undefined) return ordered.slice(0, 3); const bounded = ordered.filter((item) => side === "source" ? (item.sequence ?? boundarySequence) <= boundarySequence : (item.sequence ?? boundarySequence) >= boundarySequence); return (side === "source" ? bounded.slice(-3) : bounded.slice(0, 3)); }
