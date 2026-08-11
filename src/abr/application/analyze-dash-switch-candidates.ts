import type { ReportedContext } from "../../investigation/application/parse-reported-context.js";
import type { DashAdaptationSet, DashManifestInspection, DashRepresentation } from "../../stream-tools/dash-mpd.js";
import type { MediaProbeResult, MediaSample } from "../../investigation/ports/media-sample-collector.js";
import type { Fmp4InitInspection } from "../../stream-tools/isobmff.js";
import type { AbrSwitchEvidence, AccessUnitEvidence, BoundaryEvidence, HttpRequestEvidence, ReportedPlayerContextEvidence, RepresentationSummary } from "../domain/evidence.js";
import { diffInitSegments } from "./init-semantic-diff.js";
import { evaluateAbrSwitchRules } from "./rules.js";
import { TimelineNormalizer, type TimelineTrackBoundary } from "./timeline-normalizer.js";

type SampleMaterial = { sample: MediaSample; boundary: BoundaryEvidence; timeline?: TimelineTrackBoundary };
type RepresentationMaterial = { representation: DashRepresentation; summary: RepresentationSummary; init?: Fmp4InitInspection & { evidenceId: string }; initSample?: MediaSample; segments: SampleMaterial[] };
type ProbedFragmentSample = NonNullable<MediaProbeResult["fmp4"]>["fragment"]["samples"][number];

/**
 * Builds technically testable switch candidates from a URL-only DASH investigation.
 * These objects never claim that the player performed the transition: player requests,
 * Player callbacks and exact device facts remain explicitly missing until observed.
 */
export function analyzeDashSwitchCandidates(
  dash: DashManifestInspection,
  samples: MediaSample[],
  reportedContext?: ReportedContext,
  toleranceMs = 2,
): AbrSwitchEvidence[] {
  const materials = buildMaterials(dash, samples);
  const candidates: AbrSwitchEvidence[] = [];
  for (const adaptationSet of dash.adaptationSets.filter((entry) => entry.contentType === "video")) {
    const group = adaptationSet.representationIds.flatMap((id) => materials.get(id) ? [materials.get(id)!] : []);
    for (const source of group) for (const target of group) {
      if (source.representation.id === target.representation.id) continue;
      candidates.push(buildCandidate({ source, target, adaptationSet, samples, ...(reportedContext ? { reportedContext } : {}), toleranceMs }));
    }
  }
  return candidates;
}

function buildCandidate(input: { source: RepresentationMaterial; target: RepresentationMaterial; adaptationSet: DashAdaptationSet; samples: MediaSample[]; reportedContext?: ReportedContext; toleranceMs: number }): AbrSwitchEvidence {
  const sourceId = input.source.representation.id; const targetId = input.target.representation.id;
  const switchId = `url-candidate:p${input.adaptationSet.periodIndex}:a${input.adaptationSet.index}:${sourceId}->${targetId}`;
  const pair = selectAdjacentBoundary(input.source.segments, input.target.segments, input.reportedContext?.approximateTimeSeconds);
  const contract = { evidenceId: `mpd-switching-contract:p${input.adaptationSet.periodIndex}:a${input.adaptationSet.index}`, ...input.adaptationSet.switchingContract };
  const initSemanticDiff = input.source.init && input.target.init ? diffInitSegments({ evidenceId: `init-diff:${switchId}`, parameterSetEvidenceId: `parameter-set-diff:${switchId}`, source: input.source.init, target: input.target.init, contract, sameAdaptationSet: true }) : undefined;
  const audio = audioBoundaries(input.samples, pair?.source.sample, pair?.target.sample);
  const timelineEvidence = pair?.source.timeline && pair.target.timeline
    ? new TimelineNormalizer().normalize({ evidenceId: `timeline:${switchId}`, sourceVideo: pair.source.timeline, targetVideo: pair.target.timeline, ...(audio.source ? { sourceAudio: audio.source } : {}), ...(audio.target ? { targetAudio: audio.target } : {}), toleranceMs: input.toleranceMs })
    : undefined;
  const sapEvidence = pair?.target ? sapFromBoundary(`sap:${switchId}`, contract.startWithSap, pair.target.boundary) : undefined;
  const reportedPlayerContext = input.reportedContext ? toReportedPlayerContext(switchId, input.reportedContext) : undefined;
  const networkRequests = investigationFetchEvidence(switchId, input.source, input.target, pair);
  const evidence: AbrSwitchEvidence = {
    evidenceId: `abr-switch:${switchId}`,
    switchId,
    evidenceBasis: "URL_STATIC_ANALYSIS",
    transitionStatus: "CANDIDATE",
    timestamps: { ...(pair?.target.sample.presentationStartSeconds === undefined ? {} : { candidateBoundaryPresentationTimeMs: pair.target.sample.presentationStartSeconds * 1_000 }) },
    sourceRepresentation: input.source.summary,
    targetRepresentation: input.target.summary,
    direction: direction(input.source.summary, input.target.summary),
    switchKind: switchKind(input.source.summary, input.target.summary),
    switchingContract: contract,
    ...(reportedPlayerContext ? { reportedPlayerContext } : {}),
    networkEvidence: { evidenceId: `network:${switchId}`, requests: networkRequests },
    ...(input.source.init ? { sourceInit: input.source.init } : {}),
    ...(input.target.init ? { targetInit: input.target.init } : {}),
    ...(initSemanticDiff ? { initSemanticDiff, codecDiff: initSemanticDiff.parameterSets } : {}),
    ...(pair?.source ? { sourceBoundary: pair.source.boundary } : {}),
    ...(pair?.target ? { targetBoundary: pair.target.boundary } : {}),
    ...(sapEvidence ? { sapEvidence } : {}),
    ...(timelineEvidence ? { timelineEvidence } : {}),
    decodeTests: [],
    deterministicFindings: [],
    missingEvidence: missingEvidence(input.source, input.target, pair, timelineEvidence),
  };
  evidence.deterministicFindings = evaluateAbrSwitchRules(evidence);
  return evidence;
}

function buildMaterials(dash: DashManifestInspection, samples: MediaSample[]): Map<string, RepresentationMaterial> {
  const result = new Map<string, RepresentationMaterial>();
  for (const representation of dash.representations.filter((entry) => entry.contentType === "video")) {
    const representationSamples = samples.filter((sample) => sample.kind === "media-segment" && sample.representationId === representation.id && sample.probe?.fmp4);
    if (representationSamples.length === 0) continue;
    const initSample = samples.find((sample) => sample.kind === "init-segment" && sample.representationId === representation.id);
    const observedInit = representationSamples.find((sample) => sample.probe?.fmp4?.init)?.probe?.fmp4?.init;
    const periodStartSeconds = dash.periods.find((period) => period.index === representation.periodIndex)?.startSeconds ?? 0;
    result.set(representation.id, {
      representation,
      summary: summary(representation),
      ...(observedInit ? { init: { evidenceId: initSample ? `sample:${initSample.logicalKey}` : `init-observed:${representation.id}`, ...observedInit } } : {}),
      ...(initSample ? { initSample } : {}),
      segments: representationSamples.map((sample) => materialForSample(sample, representation, periodStartSeconds)).filter((value): value is SampleMaterial => value !== undefined),
    });
  }
  return result;
}

function materialForSample(sample: MediaSample, representation: DashRepresentation, periodStartSeconds: number): SampleMaterial | undefined {
  const fragment = sample.probe?.fmp4?.fragment;
  if (!fragment) return undefined;
  const evidenceBase = `sample:${sample.logicalKey}`;
  const boundary: BoundaryEvidence = {
    evidenceId: `${evidenceBase}:boundary`,
    representationId: representation.id,
    ...(sample.sequence === undefined ? {} : { segmentNumber: sample.sequence }),
    accessUnits: fragment.samples.map((entry, index) => toAccessUnit(entry, `${evidenceBase}:au:${index}`, index)),
  };
  const timelineSamples = fragment.samples.map((entry) => ({ dts: entry.dts, pts: entry.pts, ...(entry.duration === undefined ? {} : { duration: entry.duration }) }));
  return {
    sample,
    boundary,
    ...(timelineSamples.length > 0 ? { timeline: { timescale: representation.timescale, presentationTimeOffset: representation.presentationTimeOffset, periodStartSeconds, samples: timelineSamples } } : {}),
  };
}

function selectAdjacentBoundary(source: SampleMaterial[], target: SampleMaterial[], atSeconds?: number): { source: SampleMaterial; target: SampleMaterial } | undefined {
  const pairs = source.flatMap((left) => target.flatMap((right) => {
    const leftEnd = left.sample.presentationEndSeconds; const rightStart = right.sample.presentationStartSeconds;
    if (leftEnd === undefined || rightStart === undefined) return [];
    const continuityDistance = Math.abs(rightStart - leftEnd);
    const incidentDistance = atSeconds === undefined ? 0 : Math.abs(rightStart - atSeconds);
    return [{ source: left, target: right, score: continuityDistance * 1_000 + incidentDistance }];
  }));
  return pairs.sort((left, right) => left.score - right.score)[0];
}

function audioBoundaries(samples: MediaSample[], sourceVideo: MediaSample | undefined, targetVideo: MediaSample | undefined): { source?: TimelineTrackBoundary; target?: TimelineTrackBoundary } {
  const audioSamples = samples.filter((sample) => sample.kind === "media-segment" && sample.probe?.fmp4 && sample.probe.tracks.some((track) => track.kind === "audio"));
  const source = closestAudio(audioSamples, sourceVideo?.presentationStartSeconds); const target = closestAudio(audioSamples, targetVideo?.presentationStartSeconds);
  return { ...(toAudioTimeline(source) ? { source: toAudioTimeline(source)! } : {}), ...(toAudioTimeline(target) ? { target: toAudioTimeline(target)! } : {}) };
}

function closestAudio(samples: MediaSample[], start: number | undefined): MediaSample | undefined { return start === undefined ? undefined : [...samples].sort((left, right) => Math.abs((left.presentationStartSeconds ?? Infinity) - start) - Math.abs((right.presentationStartSeconds ?? Infinity) - start))[0]; }
function toAudioTimeline(sample: MediaSample | undefined): TimelineTrackBoundary | undefined { const fragment = sample?.probe?.fmp4?.fragment; const track = sample?.probe?.tracks.find((entry) => entry.kind === "audio"); const timeBase = track?.timeBase; const timescale = timeBase ? denominator(timeBase) : undefined; return fragment && timescale ? { timescale, samples: fragment.samples.map((entry) => ({ dts: entry.dts, pts: entry.pts, ...(entry.duration === undefined ? {} : { duration: entry.duration }) })) } : undefined; }
function denominator(value: string): number | undefined { const match = /^\d+\/(\d+)$/.exec(value); const parsed = match ? Number(match[1]) : undefined; return parsed && Number.isFinite(parsed) ? parsed : undefined; }

function investigationFetchEvidence(switchId: string, source: RepresentationMaterial, target: RepresentationMaterial, pair: { source: SampleMaterial; target: SampleMaterial } | undefined): HttpRequestEvidence[] {
  const selected: Array<{ sample: MediaSample | undefined; kind: HttpRequestEvidence["resourceKind"]; representationId: string }> = [
    { sample: source.initSample, kind: "init", representationId: source.representation.id },
    { sample: pair?.source.sample, kind: "video", representationId: source.representation.id },
    { sample: target.initSample, kind: "init", representationId: target.representation.id },
    { sample: pair?.target.sample, kind: "video", representationId: target.representation.id },
  ];
  return selected.flatMap(({ sample, kind, representationId }, index) => sample?.source ? [{ evidenceId: `fetch:${switchId}:${index}`, captureSource: "INVESTIGATION_FETCH" as const, url: sample.source.url, resourceKind: kind, representationId, requestStartMs: 0, status: sample.source.httpStatus, ...(sample.source.contentLength === undefined ? {} : { contentLength: sample.source.contentLength }), downloadedBytes: sample.content.bytes.byteLength, completed: sample.source.httpStatus >= 200 && sample.source.httpStatus < 300, ...(sample.sequence === undefined ? {} : { mediaSequence: sample.sequence }) }] : []);
}

function toReportedPlayerContext(switchId: string, context: ReportedContext): ReportedPlayerContextEvidence {
  return { evidenceId: `reported-context:${switchId}`, source: "problem_description", ...(context.reportedDevice?.manufacturer ? { manufacturer: context.reportedDevice.manufacturer } : {}), ...(context.reportedDevice?.modelCode ? { modelCode: context.reportedDevice.modelCode } : {}), ...(context.reportedDevice?.firmwareVersion ? { firmwareVersion: context.reportedDevice.firmwareVersion } : {}), ...(context.reportedDevice?.operatingSystem ? { operatingSystem: context.reportedDevice.operatingSystem } : {}), ...(context.reportedDevice?.operatingSystemVersion ? { operatingSystemVersion: context.reportedDevice.operatingSystemVersion } : {}), ...(context.reportedDevice?.applicationVersion ? { applicationVersion: context.reportedDevice.applicationVersion } : {}), ...(context.reportedDevice?.playerName ? { playerName: context.reportedDevice.playerName } : {}), ...(context.reportedDevice?.playerVersion ? { playerVersion: context.reportedDevice.playerVersion } : {}), ...(context.reportedDevice?.drmSystem ? { drmSystem: context.reportedDevice.drmSystem } : {}), ...(context.reportedDevice?.displayOrHdrMode ? { displayOrHdrMode: context.reportedDevice.displayOrHdrMode } : {}), mentionedPlayerEvents: context.mentionedPlayerEvents, reportsVideoFreeze: context.reportsVideoFreeze, reportsAudioContinues: context.reportsAudioContinues, reportsAbrSwitch: context.reportsAbrSwitch, ...(context.reportedAbrDirection ? { reportedAbrDirection: context.reportedAbrDirection } : {}), ...(context.reportedResolutionTransition ? { reportedResolutionTransition: context.reportedResolutionTransition } : {}), ...(context.descriptionExcerpt ? { descriptionExcerpt: context.descriptionExcerpt } : {}) };
}

function summary(representation: DashRepresentation): RepresentationSummary { return { evidenceId: `representation:${representation.id}`, id: representation.id, periodIndex: representation.periodIndex, adaptationSetIndex: representation.adaptationSetIndex, ...(representation.bandwidth === undefined ? {} : { bandwidth: representation.bandwidth }), ...(representation.codecs ? { codecs: representation.codecs } : {}), ...(/^(hvc1|hev1)/i.exec(representation.codecs ?? "")?.[1] ? { sampleEntry: /^(hvc1|hev1)/i.exec(representation.codecs ?? "")![1]!.toLowerCase() } : {}), ...(representation.width === undefined ? {} : { width: representation.width }), ...(representation.height === undefined ? {} : { height: representation.height }), ...(representation.frameRate ? { frameRate: representation.frameRate } : {}), timescale: representation.timescale, presentationTimeOffset: String(representation.presentationTimeOffset) }; }
function toAccessUnit(entry: ProbedFragmentSample, evidenceId: string, index: number): AccessUnitEvidence { const unit = entry.accessUnit; return { evidenceId, index, pts: entry.pts, dts: entry.dts, ...(entry.duration === undefined ? {} : { duration: entry.duration }), ...(entry.sync === undefined ? {} : { keyFrameAccordingToFfprobe: entry.sync }), nalTypes: unit.nalTypes, ...(unit.firstVclNalType ? { firstVclNalType: unit.firstVclNalType } : {}), isIrap: unit.isIrap, ...(unit.irapType ? { irapType: unit.irapType } : {}), hasVpsBeforeFirstVcl: unit.hasVpsBeforeFirstVcl, hasSpsBeforeFirstVcl: unit.hasSpsBeforeFirstVcl, hasPpsBeforeFirstVcl: unit.hasPpsBeforeFirstVcl, parameterSetIdsReferenced: unit.parameterSetIdsReferenced, containsRasl: unit.containsRasl, containsRadl: unit.containsRadl }; }
function sapFromBoundary(evidenceId: string, claim: number | undefined, boundary: BoundaryEvidence): NonNullable<AbrSwitchEvidence["sapEvidence"]> { const first = boundary.accessUnits[0]; const observedSapType = first?.irapType === "CRA" ? 2 : first?.isIrap ? 1 : undefined; const compatible = claim === undefined || observedSapType === undefined ? "unknown" : claim === 1 ? observedSapType === 1 : claim === 2 ? observedSapType <= 2 : first?.isIrap ?? false; return { evidenceId, ...(claim === undefined ? {} : { manifestClaim: claim }), ...(observedSapType === undefined ? {} : { observedSapType }), compatible, reason: observedSapType === undefined ? "No independently classified target IRAP was observed." : compatible === true ? `Observed SAP ${observedSapType} satisfies the declared boundary.` : `Observed SAP ${observedSapType} does not satisfy startWithSAP=${claim}.` }; }
function direction(source: RepresentationSummary, target: RepresentationSummary): AbrSwitchEvidence["direction"] { const a = source.bandwidth ?? (source.width ?? 0) * (source.height ?? 0); const b = target.bandwidth ?? (target.width ?? 0) * (target.height ?? 0); return b > a ? "UPSHIFT" : b < a ? "DOWNSHIFT" : "LATERAL"; }
function switchKind(source: RepresentationSummary, target: RepresentationSummary): AbrSwitchEvidence["switchKind"] { return source.width === undefined || source.height === undefined || target.width === undefined || target.height === undefined ? "UNKNOWN" : source.width === target.width && source.height === target.height ? "SAME_RESOLUTION_BITRATE" : "RESOLUTION_CHANGING"; }
function missingEvidence(source: RepresentationMaterial, target: RepresentationMaterial, pair: { source: SampleMaterial; target: SampleMaterial } | undefined, timeline: AbrSwitchEvidence["timelineEvidence"]): string[] { return [!source.init ? "source INIT parse" : undefined, !target.init ? "target INIT parse" : undefined, !pair ? "adjacent source/target media boundary" : undefined, !timeline ? "normalized video/audio timeline boundary" : undefined, "actual player Representation transition", "player-side INIT and media request timing", "player event timeline", "device capability evidence when compatibility is in scope", "standalone and switching decode tests", "DASH-IF conformance result"].filter((value): value is string => value !== undefined); }
