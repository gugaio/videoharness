import type { DashManifestInspection } from "../../stream-tools/dash-mpd.js";
import type { MediaProbeResult, MediaSample } from "../ports/media-sample-collector.js";
import type { ReportedContext } from "../../stream-tools/reported-context.js";

export type DashForensicAnalysis = {
  candidate?: { sourceRepresentationId: string; destinationRepresentationId: string; atSeconds?: number; direction: "4k_to_full_hd" | "candidate" };
  boundaries: Array<{
    sourceRepresentationId: string;
    destinationRepresentationId: string;
    sourceSegment?: number;
    destinationSegment?: number;
    dtsDeltaSeconds?: number;
    ptsDeltaSeconds?: number;
    classification: "continuous" | "gap" | "overlap" | "regression" | "indeterminate";
    firstFrameKind?: string;
    initCompatible?: boolean;
    reasons: string[];
  }>;
  matrix: Array<{ sequence: string; structuralResult: "pass" | "warning" | "fail" | "indeterminate"; decoderResult: "not_run"; interpretation: string }>;
};

export function analyzeDashForensics(
  dash: DashManifestInspection,
  samples: MediaSample[],
  context: ReportedContext | undefined,
): DashForensicAnalysis {
  const videos = dash.representations.filter((entry) => entry.contentType === "video");
  const source = [...videos].sort((left, right) => area(right) - area(left) || (right.bandwidth ?? 0) - (left.bandwidth ?? 0))[0];
  const destination = [...videos].filter((entry) => entry.id !== source?.id).sort((left, right) => distanceToFullHd(left) - distanceToFullHd(right) || (right.bandwidth ?? 0) - (left.bandwidth ?? 0))[0];
  if (!source || !destination) return { boundaries: [], matrix: [] };
  const boundary = analyzeBoundary(source.id, destination.id, samples, context?.approximateTimeSeconds);
  const sameSource = analyzeBoundary(source.id, source.id, samples, context?.approximateTimeSeconds);
  const sameDestination = analyzeBoundary(destination.id, destination.id, samples, context?.approximateTimeSeconds);
  const inverse = analyzeBoundary(destination.id, source.id, samples, context?.approximateTimeSeconds);
  return {
    candidate: { sourceRepresentationId: source.id, destinationRepresentationId: destination.id, ...(context?.approximateTimeSeconds === undefined ? {} : { atSeconds: context.approximateTimeSeconds }), direction: isFourK(source) && isFullHd(destination) ? "4k_to_full_hd" : "candidate" },
    boundaries: [sameSource, sameDestination, boundary, inverse],
    matrix: [
      matrixEntry(`${source.id} → ${source.id}`, sameSource),
      matrixEntry(`${destination.id} → ${destination.id}`, sameDestination),
      matrixEntry(`${source.id} → ${destination.id}`, boundary),
      matrixEntry(`${destination.id} → ${source.id}`, inverse),
    ],
  };
}

function analyzeBoundary(sourceId: string, destinationId: string, samples: MediaSample[], at: number | undefined): DashForensicAnalysis["boundaries"][number] {
  const source = selectSample(samples, sourceId, at, "before");
  const destination = selectSample(samples, destinationId, at, "after");
  const sourceFrame = source?.probe?.fmp4?.fragment.samples.at(-1);
  const destinationFrame = destination?.probe?.fmp4?.fragment.samples[0];
  const sourceTimescale = source?.probe?.fmp4?.init?.timescale;
  const destinationTimescale = destination?.probe?.fmp4?.init?.timescale;
  const reasons: string[] = [];
  let dtsDeltaSeconds: number | undefined;
  let ptsDeltaSeconds: number | undefined;
  if (!source || !destination || !sourceFrame || !destinationFrame || !sourceTimescale || !destinationTimescale) {
    reasons.push("A complete fMP4 timestamp pair was not available for this candidate boundary.");
  } else {
    const sourceEndDts = BigInt(sourceFrame.dts) + BigInt(sourceFrame.duration ?? "0");
    const sourceEndPts = BigInt(sourceFrame.pts) + BigInt(sourceFrame.duration ?? "0");
    dtsDeltaSeconds = Number(BigInt(destinationFrame.dts)) / destinationTimescale - Number(sourceEndDts) / sourceTimescale;
    ptsDeltaSeconds = Number(BigInt(destinationFrame.pts)) / destinationTimescale - Number(sourceEndPts) / sourceTimescale;
  }
  const initCompatible = compatibleInit(source?.probe?.fmp4?.init, destination?.probe?.fmp4?.init);
  if (initCompatible === false) reasons.push("Initialization segment codec configuration differs across the candidate boundary.");
  if (destinationFrame?.firstFrameKind && !["idr", "cra", "bla"].includes(destinationFrame.firstFrameKind)) reasons.push(`The destination starts with ${destinationFrame.firstFrameKind}, not an independent IRAP classification.`);
  if ((source?.probe?.fmp4?.fragment.structuralErrors.length ?? 0) > 0 || (destination?.probe?.fmp4?.fragment.structuralErrors.length ?? 0) > 0) reasons.push("At least one fragment has structural fMP4 validation errors.");
  const classification = classify(dtsDeltaSeconds, ptsDeltaSeconds);
  if (classification === "gap") reasons.push("Decode or presentation timestamps leave a positive boundary gap.");
  if (classification === "overlap" || classification === "regression") reasons.push("Decode or presentation timestamps overlap/regress at the boundary.");
  return {
    sourceRepresentationId: sourceId, destinationRepresentationId: destinationId,
    ...(source?.sequence === undefined ? {} : { sourceSegment: source.sequence }),
    ...(destination?.sequence === undefined ? {} : { destinationSegment: destination.sequence }),
    ...(dtsDeltaSeconds === undefined ? {} : { dtsDeltaSeconds }),
    ...(ptsDeltaSeconds === undefined ? {} : { ptsDeltaSeconds }), classification,
    ...(destinationFrame?.firstFrameKind ? { firstFrameKind: destinationFrame.firstFrameKind } : {}),
    ...(initCompatible === undefined ? {} : { initCompatible }), reasons,
  };
}

function selectSample(samples: MediaSample[], representationId: string, at: number | undefined, side: "before" | "after"): MediaSample | undefined {
  const candidates = samples.filter((sample) => sample.kind === "media-segment" && sample.representationId === representationId && sample.probe?.fmp4);
  if (candidates.length === 0) return undefined;
  if (at === undefined) return side === "before" ? candidates[Math.floor((candidates.length - 1) / 2)] : candidates[Math.ceil((candidates.length - 1) / 2)];
  const sorted = [...candidates].sort((left, right) => (left.presentationStartSeconds ?? 0) - (right.presentationStartSeconds ?? 0));
  return side === "before"
    ? [...sorted].reverse().find((sample) => (sample.presentationStartSeconds ?? Infinity) <= at) ?? sorted[0]
    : sorted.find((sample) => (sample.presentationEndSeconds ?? -Infinity) >= at) ?? sorted.at(-1);
}
function classify(dts: number | undefined, pts: number | undefined): DashForensicAnalysis["boundaries"][number]["classification"] {
  if (dts === undefined || pts === undefined) return "indeterminate";
  const delta = Math.abs(dts) > Math.abs(pts) ? dts : pts;
  if (delta < -0.001) return delta < -1 ? "regression" : "overlap";
  if (delta > 0.050) return "gap";
  return "continuous";
}
type Fmp4Init = NonNullable<NonNullable<MediaProbeResult["fmp4"]>["init"]>;
function compatibleInit(leftInit: Fmp4Init | undefined, rightInit: Fmp4Init | undefined): boolean | undefined {
  if (!leftInit || !rightInit) return undefined;
  return leftInit.fourcc === rightInit.fourcc
    && leftInit.hevc?.profileIdc === rightInit.hevc?.profileIdc
    && leftInit.hevc?.levelIdc === rightInit.hevc?.levelIdc
    && leftInit.hevc?.bitDepthLuma === rightInit.hevc?.bitDepthLuma
    && JSON.stringify(leftInit.hevc?.parameterSetHashes) === JSON.stringify(rightInit.hevc?.parameterSetHashes);
}
function matrixEntry(sequence: string, boundary: DashForensicAnalysis["boundaries"][number]): DashForensicAnalysis["matrix"][number] { const structuralResult = boundary.classification === "continuous" && boundary.initCompatible !== false && !boundary.reasons.some((reason) => /not an independent|structural/.test(reason)) ? "pass" : boundary.classification === "indeterminate" ? "indeterminate" : boundary.classification === "gap" || boundary.classification === "overlap" || boundary.classification === "regression" || boundary.initCompatible === false ? "fail" : "warning"; return { sequence, structuralResult, decoderResult: "not_run", interpretation: boundary.reasons.join(" ") || "No structural anomaly was found in the collected boundary." }; }
function area(entry: DashManifestInspection["representations"][number]): number { return (entry.width ?? 0) * (entry.height ?? 0); }
function distanceToFullHd(entry: DashManifestInspection["representations"][number]): number { return Math.abs((entry.width ?? 0) - 1920) + Math.abs((entry.height ?? 0) - 1080); }
function isFourK(entry: DashManifestInspection["representations"][number]): boolean { return (entry.width ?? 0) >= 3000 || (entry.height ?? 0) >= 2000; }
function isFullHd(entry: DashManifestInspection["representations"][number]): boolean { return (entry.width ?? 0) >= 1800 && (entry.width ?? 0) <= 2200 || (entry.height ?? 0) >= 1000 && (entry.height ?? 0) <= 1200; }
