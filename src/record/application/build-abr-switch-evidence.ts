import type { AccessUnitEvidence, AbrSwitchEvidence, BoundaryEvidence, HttpRequestEvidence, RepresentationSummary } from "../../abr/domain/evidence.js";
import { AbrSwitchCorrelator, type RepresentationDiagnosticMaterial } from "../../abr/application/abr-switch-correlator.js";
import type { Fmp4InitInspection, HevcAccessUnitInspection } from "../../stream-tools/isobmff.js";
import type { SwitchingContract } from "../../stream-tools/dash-mpd.js";
import type { DeliveryRequest, PlaybackRunRepository, RecordedDiagnosticResource } from "../ports/playback-run.js";
import type { TimelineTrackBoundary } from "../../abr/application/timeline-normalizer.js";

export async function buildPlaybackRunAbrSwitchEvidence(input: { recordingId: string; runId: string; repository: PlaybackRunRepository }): Promise<AbrSwitchEvidence[] | "unavailable"> {
  if (!input.repository.listDiagnosticResources) return "unavailable";
  const [deliveries, resources] = await Promise.all([
    input.repository.listDeliveries(input.recordingId, input.runId, 10_000),
    input.repository.listDiagnosticResources(input.recordingId),
  ]);
  const master = resources.find((resource) => resource.logicalPath === "index.mpd");
  if (!master || deliveries.length === 0) return [];
  const materials = buildMaterials(resources);
  const contract = switchingContract(master, materials);
  const firstStartedAt = Math.min(...deliveries.map((request) => Date.parse(request.startedAt)));
  const httpRequests = deliveries.map((request) => toHttpEvidence(input.runId, request, resources, firstStartedAt));
  return new AbrSwitchCorrelator().correlate({
    sessionId: input.runId,
    switchingContract: { evidenceId: `mpd-switching-contract:${input.recordingId}`, ...contract },
    httpRequests,
    representations: materials,
    audioTimelineByVideoSequence: audioTimelines(resources),
  });
}

function buildMaterials(resources: RecordedDiagnosticResource[]): Map<string, RepresentationDiagnosticMaterial> {
  const materials = new Map<string, RepresentationDiagnosticMaterial>();
  for (const resource of resources.filter((item) => item.resourceKind === "init-segment")) {
    const metadata = resource.metadata; const targetId = string(metadata.targetId); const init = asInit(metadata.init);
    if (!targetId) continue;
    materials.set(targetId, { summary: representationSummary(targetId, metadata, init), ...(init ? { init: { evidenceId: `init:${resource.sha256}`, ...init } } : {}), segments: [] });
  }
  for (const resource of resources.filter((item) => item.resourceKind === "video-segment")) {
    const metadata = resource.metadata; const targetId = string(metadata.targetId); const material = targetId ? materials.get(targetId) : undefined; const fragment = record(metadata.fragment);
    if (!targetId || !material || !fragment) continue;
    const samples = array(fragment.boundarySamples).flatMap((value, index) => accessUnit(value, `access-unit:${resource.sha256}:${index}`, index));
    const sequence = finite(metadata.mediaSequence);
    const boundary: BoundaryEvidence = { evidenceId: `boundary:${resource.sha256}`, representationId: targetId, ...(sequence === undefined ? {} : { segmentNumber: sequence }), accessUnits: samples };
    const timelineSamples = array(fragment.boundarySamples).flatMap(timelineSample);
    const timescale = finite(metadata.timescale);
    material.segments.push({ ...(sequence === undefined ? {} : { mediaSequence: sequence }), boundary, ...(timescale && timelineSamples.length > 0 ? { timeline: { timescale, presentationTimeOffset: string(metadata.presentationTimeOffset) ?? "0", samples: timelineSamples } } : {}) });
  }
  for (const material of materials.values()) material.segments.sort((left, right) => (left.mediaSequence ?? 0) - (right.mediaSequence ?? 0));
  return materials;
}

function representationSummary(targetId: string, metadata: Record<string, unknown>, init: Fmp4InitInspection | undefined): RepresentationSummary {
  return { evidenceId: `representation:${targetId}`, id: targetId, periodIndex: finite(metadata.periodIndex) ?? 0, adaptationSetIndex: finite(metadata.adaptationSetIndex) ?? 0, ...optionalNumber("bandwidth", metadata.bandwidth), ...optionalString("codecs", metadata.codecs), ...(init?.fourcc ? { sampleEntry: init.fourcc } : {}), ...optionalNumber("width", metadata.width), ...optionalNumber("height", metadata.height), ...optionalString("frameRate", metadata.frameRate), ...optionalNumber("timescale", metadata.timescale), ...optionalString("presentationTimeOffset", metadata.presentationTimeOffset) };
}

function switchingContract(master: RecordedDiagnosticResource, materials: Map<string, RepresentationDiagnosticMaterial>): SwitchingContract {
  const value = record(master.metadata.switchingContract);
  if (value && isMode(value.mode) && typeof value.codecFamily === "string" && Array.isArray(value.representations)) return value as unknown as SwitchingContract;
  const first = [...materials.values()][0]?.summary;
  return { mode: "UNKNOWN", codecFamily: /^(?:hvc1|hev1)/i.test(first?.codecs ?? "") ? "HEVC" : "UNKNOWN", representations: [...materials.keys()] };
}

function toHttpEvidence(runId: string, request: DeliveryRequest, resources: RecordedDiagnosticResource[], firstStartedAt: number): HttpRequestEvidence {
  const start = Date.parse(request.startedAt); const end = Date.parse(request.completedAt); const resource = resources.find((item) => item.logicalPath === request.logicalPath); const durationMs = Math.max(1, end - start);
  return { evidenceId: `http:${runId}:${request.id}`, captureSource: "PLAYBACK_REQUEST", url: `recording://${request.logicalPath}`, resourceKind: request.resourceKind === "init-segment" ? "init" : request.resourceKind === "video-segment" ? "video" : request.resourceKind === "audio-segment" ? "audio" : request.resourceKind === "master" ? "mpd" : "other", ...(request.targetId ? { representationId: request.targetId } : {}), requestStartMs: start - firstStartedAt, wallClockAt: request.startedAt, requestEndMs: end - firstStartedAt, status: request.statusCode, ...(resource ? { contentLength: resource.sizeBytes } : {}), downloadedBytes: request.bytesSent, throughputKbps: request.bytesSent * 8 / durationMs, latencyMs: request.latencyMs, completed: request.statusCode >= 200 && request.statusCode < 300, ...(request.mediaSequence === undefined ? {} : { mediaSequence: request.mediaSequence }) };
}

function audioTimelines(resources: RecordedDiagnosticResource[]): Map<number, TimelineTrackBoundary> {
  const result = new Map<number, TimelineTrackBoundary>();
  for (const resource of resources.filter((item) => item.resourceKind === "audio-segment")) { const sequence = finite(resource.metadata.mediaSequence); const fragment = record(resource.metadata.fragment); const timescale = finite(resource.metadata.timescale); const samples = array(fragment?.boundarySamples).flatMap(timelineSample); if (sequence !== undefined && timescale && samples.length > 0 && !result.has(sequence)) result.set(sequence, { timescale, presentationTimeOffset: string(resource.metadata.presentationTimeOffset) ?? "0", samples }); }
  return result;
}

function accessUnit(value: unknown, evidenceId: string, index: number): AccessUnitEvidence[] {
  const sample = record(value); const unit = asAccessUnit(sample?.accessUnit); if (!sample || !unit) return [];
  return [{ evidenceId, index, ...optionalString("pts", sample.pts), ...optionalString("dts", sample.dts), ...optionalString("duration", sample.duration), ...(typeof sample.sync === "boolean" ? { keyFrameAccordingToFfprobe: sample.sync } : {}), nalTypes: unit.nalTypes, ...(unit.firstVclNalType ? { firstVclNalType: unit.firstVclNalType } : {}), isIrap: unit.isIrap, ...(unit.irapType ? { irapType: unit.irapType } : {}), hasVpsBeforeFirstVcl: unit.hasVpsBeforeFirstVcl, hasSpsBeforeFirstVcl: unit.hasSpsBeforeFirstVcl, hasPpsBeforeFirstVcl: unit.hasPpsBeforeFirstVcl, parameterSetIdsReferenced: unit.parameterSetIdsReferenced, containsRasl: unit.containsRasl, containsRadl: unit.containsRadl }];
}
function timelineSample(value: unknown): TimelineTrackBoundary["samples"] { const sample = record(value); const dts = sample ? string(sample.dts) : undefined; const pts = sample ? string(sample.pts) : undefined; return dts && pts ? [{ dts, pts, ...optionalString("duration", sample!.duration) }] : []; }
function asInit(value: unknown): Fmp4InitInspection | undefined { const parsed = record(value); return parsed && typeof parsed.sha256 === "string" && Array.isArray(parsed.tracks) && Array.isArray(parsed.trex) && record(parsed.drm) ? parsed as unknown as Fmp4InitInspection : undefined; }
function asAccessUnit(value: unknown): HevcAccessUnitInspection | undefined { const parsed = record(value); return parsed && Array.isArray(parsed.nalTypes) && typeof parsed.isIrap === "boolean" && typeof parsed.hasVpsBeforeFirstVcl === "boolean" && typeof parsed.hasSpsBeforeFirstVcl === "boolean" && typeof parsed.hasPpsBeforeFirstVcl === "boolean" && record(parsed.parameterSetIdsReferenced) && typeof parsed.containsRasl === "boolean" && typeof parsed.containsRadl === "boolean" ? parsed as unknown as HevcAccessUnitInspection : undefined; }
function record(value: unknown): Record<string, unknown> | undefined { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function string(value: unknown): string | undefined { return typeof value === "string" ? value : typeof value === "number" || typeof value === "bigint" ? String(value) : undefined; }
function finite(value: unknown): number | undefined { const number = Number(value); return Number.isFinite(number) ? number : undefined; }
function optionalString<K extends string>(key: K, value: unknown): Partial<Record<K, string>> { const parsed = string(value); return parsed === undefined ? {} : { [key]: parsed } as Partial<Record<K, string>>; }
function optionalNumber<K extends string>(key: K, value: unknown): Partial<Record<K, number>> { const parsed = finite(value); return parsed === undefined ? {} : { [key]: parsed } as Partial<Record<K, number>>; }
function isMode(value: unknown): value is SwitchingContract["mode"] { return value === "GENERAL_REINITIALIZATION" || value === "BITSTREAM_SWITCHING" || value === "CMAF_SWITCHING_SET" || value === "UNKNOWN"; }
