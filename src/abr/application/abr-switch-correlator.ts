import { randomUUID } from "node:crypto";
import type { PlayerEventEvidence, AbrSwitchEvidence, BoundaryEvidence, ConformanceSummary, DecodeTestResult, DeviceCapabilityEvidence, HttpRequestEvidence, RepresentationSummary } from "../domain/evidence.js";
import type { Fmp4InitInspection } from "../../stream-tools/isobmff.js";
import type { SwitchingContract } from "../../stream-tools/dash-mpd.js";
import { diffInitSegments } from "./init-semantic-diff.js";
import { evaluateAbrSwitchRules, type AbrRuleOptions } from "./rules.js";
import { TimelineNormalizer, type TimelineTrackBoundary } from "./timeline-normalizer.js";

export type RepresentationDiagnosticMaterial = {
  summary: RepresentationSummary;
  init?: Fmp4InitInspection & { evidenceId: string };
  segments: Array<{
    mediaSequence?: number;
    boundary: BoundaryEvidence;
    timeline?: TimelineTrackBoundary;
  }>;
};

export type AbrSwitchCorrelatorInput = {
  sessionId: string;
  switchingContract: SwitchingContract & { evidenceId: string };
  httpRequests: HttpRequestEvidence[];
  playerEvents?: PlayerEventEvidence[];
  representations: Map<string, RepresentationDiagnosticMaterial>;
  audioTimelineByVideoSequence?: Map<number, TimelineTrackBoundary>;
  deviceCapabilityEvidence?: DeviceCapabilityEvidence;
  decodeTestsByDirection?: Map<string, DecodeTestResult[]>;
  conformance?: ConformanceSummary;
  ruleOptions?: AbrRuleOptions;
  timelineToleranceMs?: number;
};

/** Reconstructs actual request-level Representation transitions and their compact diagnostic windows. */
export class AbrSwitchCorrelator {
  private readonly timeline = new TimelineNormalizer();

  correlate(input: AbrSwitchCorrelatorInput): AbrSwitchEvidence[] {
    const ordered = [...input.httpRequests].sort((left, right) => left.requestStartMs - right.requestStartMs);
    const video = ordered.filter(isCompletedVideoRequest);
    const switches: AbrSwitchEvidence[] = [];
    let sourceRequest: HttpRequestEvidence | undefined;
    for (const targetRequest of video) {
      if (!sourceRequest) { sourceRequest = targetRequest; continue; }
      if (sourceRequest.representationId === targetRequest.representationId) { sourceRequest = targetRequest; continue; }
      const sourceId = sourceRequest.representationId!; const targetId = targetRequest.representationId!;
      const source = input.representations.get(sourceId); const target = input.representations.get(targetId);
      if (!source || !target) { sourceRequest = targetRequest; continue; }
      const switchIndex = switches.length;
      const switchId = `${input.sessionId}:abr:${switchIndex + 1}:${sourceId}->${targetId}`;
      const sourceSegment = matchSegment(source, sourceRequest.mediaSequence, "last");
      const targetSegment = matchSegment(target, targetRequest.mediaSequence, "first");
      const targetInitRequest = latestBefore(ordered, targetRequest.requestStartMs, (request) => request.resourceKind === "init" && request.representationId === targetId);
      const symptomAt = findSymptomTime(input.playerEvents ?? [], targetRequest.requestStartMs);
      const relevantRequests = ordered.filter((request) => request.requestStartMs >= sourceRequest!.requestStartMs - 1_000 && request.requestStartMs <= targetRequest.requestStartMs + 15_000);
      const relevantPlayerEvents = (input.playerEvents ?? []).filter((event) => event.monotonicMs >= sourceRequest!.requestStartMs - 1_000 && event.monotonicMs <= targetRequest.requestStartMs + 15_000);
      const networkEvidence: AbrSwitchEvidence["networkEvidence"] = {
        evidenceId: `network:${switchId}`,
        requests: relevantRequests,
        ...(targetInitRequest ? { targetInitCompletedBeforeSymptom: completedBefore(targetInitRequest, symptomAt) } : {}),
        targetMediaCompletedBeforeSymptom: completedBefore(targetRequest, symptomAt),
      };
      const initSemanticDiff = source.init && target.init ? diffInitSegments({ evidenceId: `init-diff:${switchId}`, parameterSetEvidenceId: `parameter-set-diff:${switchId}`, source: source.init, target: target.init, contract: input.switchingContract, sameAdaptationSet: sameAdaptationSet(source.summary, target.summary) }) : undefined;
      const sourceAudio = sourceRequest.mediaSequence === undefined ? undefined : input.audioTimelineByVideoSequence?.get(sourceRequest.mediaSequence);
      const targetAudio = targetRequest.mediaSequence === undefined ? undefined : input.audioTimelineByVideoSequence?.get(targetRequest.mediaSequence);
      const timelineEvidence = sourceSegment?.timeline && targetSegment?.timeline ? this.timeline.normalize({ evidenceId: `timeline:${switchId}`, sourceVideo: sourceSegment.timeline, targetVideo: targetSegment.timeline, ...(sourceAudio ? { sourceAudio } : {}), ...(targetAudio ? { targetAudio } : {}), toleranceMs: input.timelineToleranceMs ?? 2 }) : undefined;
      const sapEvidence = targetSegment ? sapFromBoundary(`sap:${switchId}`, input.switchingContract.startWithSap, targetSegment.boundary) : undefined;
      const decodeTests = input.decodeTestsByDirection?.get(`${sourceId}->${targetId}`) ?? [];
      const evidence: AbrSwitchEvidence = {
        evidenceId: `abr-switch:${switchId}`,
        switchId,
        evidenceBasis: "PLAYBACK_NETWORK_OBSERVED",
        transitionStatus: "OBSERVED",
        timestamps: {
          detectedAtMonotonicMs: targetRequest.requestStartMs,
          ...(targetRequest.wallClockAt ? { detectedAtWallClock: targetRequest.wallClockAt } : {}),
          sourceLastRequestMs: sourceRequest.requestStartMs,
          ...(targetInitRequest ? { targetInitRequestMs: targetInitRequest.requestStartMs } : {}),
          targetFirstMediaRequestMs: targetRequest.requestStartMs,
        },
        sourceRepresentation: source.summary,
        targetRepresentation: target.summary,
        direction: direction(source.summary, target.summary),
        switchKind: switchKind(source.summary, target.summary),
        switchingContract: input.switchingContract,
        ...(relevantPlayerEvents.length > 0 ? { playerEvidence: { evidenceId: `player:${switchId}`, events: relevantPlayerEvents, audioOrPlaytimeContinuedAfterVideoFreeze: inferAudioContinuation(relevantPlayerEvents) } } : {}),
        networkEvidence,
        ...(source.init ? { sourceInit: source.init } : {}),
        ...(target.init ? { targetInit: target.init } : {}),
        ...(initSemanticDiff ? { initSemanticDiff, codecDiff: initSemanticDiff.parameterSets } : {}),
        ...(sourceSegment ? { sourceBoundary: sourceSegment.boundary } : {}),
        ...(targetSegment ? { targetBoundary: targetSegment.boundary } : {}),
        ...(sapEvidence ? { sapEvidence } : {}),
        ...(timelineEvidence ? { timelineEvidence } : {}),
        ...(input.deviceCapabilityEvidence ? { deviceCapabilityEvidence: input.deviceCapabilityEvidence } : {}),
        decodeTests,
        ...(input.conformance ? { conformance: input.conformance } : {}),
        deterministicFindings: [],
        missingEvidence: missingEvidence({ source, target, ...(targetInitRequest ? { targetInitRequest } : {}), ...(targetSegment ? { targetSegment } : {}), ...(timelineEvidence ? { timelineEvidence } : {}), playerEvents: relevantPlayerEvents, ...(input.deviceCapabilityEvidence ? { device: input.deviceCapabilityEvidence } : {}), decodeTests, ...(input.conformance ? { conformance: input.conformance } : {}) }),
      };
      evidence.deterministicFindings = evaluateAbrSwitchRules(evidence, input.ruleOptions);
      switches.push(evidence);
      sourceRequest = targetRequest;
    }
    return switches;
  }
}

function isCompletedVideoRequest(request: HttpRequestEvidence): boolean { return request.resourceKind === "video" && Boolean(request.representationId) && request.completed && !request.cancelled && (request.status ?? 200) >= 200 && (request.status ?? 200) < 300; }
function latestBefore(requests: HttpRequestEvidence[], at: number, predicate: (request: HttpRequestEvidence) => boolean): HttpRequestEvidence | undefined { return [...requests].reverse().find((request) => request.requestStartMs <= at && predicate(request)); }
function completedBefore(request: HttpRequestEvidence, at: number | undefined): boolean { return request.completed && request.requestEndMs !== undefined && (at === undefined || request.requestEndMs <= at); }
function findSymptomTime(events: PlayerEventEvidence[], fallback: number): number | undefined { return events.find((event) => event.monotonicMs >= fallback && /bufferingstart|freeze|error/i.test(`${event.type} ${event.detail ?? ""}`))?.monotonicMs; }
function matchSegment(material: RepresentationDiagnosticMaterial, sequence: number | undefined, side: "first" | "last"): RepresentationDiagnosticMaterial["segments"][number] | undefined { return sequence === undefined ? (side === "first" ? material.segments[0] : material.segments.at(-1)) : material.segments.find((segment) => segment.mediaSequence === sequence) ?? (side === "first" ? material.segments[0] : material.segments.at(-1)); }
function sameAdaptationSet(left: RepresentationSummary, right: RepresentationSummary): boolean { return left.periodIndex === right.periodIndex && left.adaptationSetIndex === right.adaptationSetIndex; }
function direction(source: RepresentationSummary, target: RepresentationSummary): AbrSwitchEvidence["direction"] { const sourceRank = source.bandwidth ?? (source.width ?? 0) * (source.height ?? 0); const targetRank = target.bandwidth ?? (target.width ?? 0) * (target.height ?? 0); return targetRank > sourceRank ? "UPSHIFT" : targetRank < sourceRank ? "DOWNSHIFT" : "LATERAL"; }
function switchKind(source: RepresentationSummary, target: RepresentationSummary): AbrSwitchEvidence["switchKind"] { return source.width === undefined || source.height === undefined || target.width === undefined || target.height === undefined ? "UNKNOWN" : source.width === target.width && source.height === target.height ? "SAME_RESOLUTION_BITRATE" : "RESOLUTION_CHANGING"; }
function sapFromBoundary(evidenceId: string, claim: number | undefined, boundary: BoundaryEvidence): NonNullable<AbrSwitchEvidence["sapEvidence"]> { const first = boundary.accessUnits[0]; const observedSapType = first?.irapType === "CRA" ? 2 : first?.isIrap ? 1 : undefined; const compatible = claim === undefined || observedSapType === undefined ? "unknown" : claim === 1 ? observedSapType === 1 : claim === 2 ? observedSapType <= 2 : first?.isIrap ?? false; return { evidenceId, ...(claim === undefined ? {} : { manifestClaim: claim }), ...(observedSapType === undefined ? {} : { observedSapType }), compatible, reason: observedSapType === undefined ? "No independently classified target IRAP was observed." : compatible === true ? `Observed SAP ${observedSapType} satisfies the declared boundary.` : `Observed SAP ${observedSapType} does not satisfy startWithSAP=${claim}.` }; }
function inferAudioContinuation(events: PlayerEventEvidence[]): boolean { const freeze = events.find((event) => /bufferingstart|freeze/i.test(`${event.type} ${event.detail ?? ""}`)); return freeze ? events.some((event) => event.monotonicMs > freeze.monotonicMs && /currentplaytime|audio/i.test(`${event.type} ${event.detail ?? ""}`)) : false; }
function missingEvidence(input: { source: RepresentationDiagnosticMaterial; target: RepresentationDiagnosticMaterial; targetInitRequest?: HttpRequestEvidence; targetSegment?: RepresentationDiagnosticMaterial["segments"][number]; timelineEvidence?: AbrSwitchEvidence["timelineEvidence"]; playerEvents: PlayerEventEvidence[]; device?: DeviceCapabilityEvidence; decodeTests: DecodeTestResult[]; conformance?: ConformanceSummary }): string[] { return [!input.source.init ? "source INIT parse" : undefined, !input.target.init ? "target INIT parse" : undefined, !input.targetInitRequest ? "target INIT HTTP request" : undefined, !input.targetSegment ? "target media boundary" : undefined, !input.timelineEvidence ? "normalized video/audio timeline boundary" : undefined, input.playerEvents.length === 0 ? "player event timeline" : undefined, !input.device?.modelCode ? "device capability evidence when compatibility is in scope" : undefined, input.decodeTests.length === 0 ? "standalone and switching decode tests" : undefined, !input.conformance ? "DASH-IF conformance result" : undefined].filter((value): value is string => value !== undefined); }

/** Useful for non-persisted fixtures and offline analysis where the caller has no session UUID. */
export function newAbrSessionId(): string { return randomUUID(); }
