import type { InitDiffClassification, InitSemanticDiff, SemanticDiffImpact, SemanticParameterSetChange, SemanticParameterSetDiff } from "../domain/evidence.js";
import type { Fmp4InitInspection, Fmp4TrackInspection, ParameterSetEvidence } from "../../stream-tools/isobmff.js";
import type { SwitchingContract } from "../../stream-tools/dash-mpd.js";

export type InitSemanticDiffInput = {
  evidenceId: string;
  parameterSetEvidenceId: string;
  source: Fmp4InitInspection;
  target: Fmp4InitInspection;
  contract?: SwitchingContract;
  sameAdaptationSet?: boolean;
};

export function diffInitSegments(input: InitSemanticDiffInput): InitSemanticDiff {
  const differences: InitSemanticDiff["differences"] = [];
  const sourceTrack = primaryVideoTrack(input.source);
  const targetTrack = primaryVideoTrack(input.target);
  compare(differences, "sampleEntry", sampleEntry(sourceTrack, input.source), sampleEntry(targetTrack, input.target), input.sameAdaptationSet ? "SWITCHING_CONTRACT_VIOLATION" : "EXPECTED_DECODER_RECONFIGURATION");
  compare(differences, "trackId", sourceTrack?.trackId, targetTrack?.trackId, input.contract?.bitstreamSwitching ? "SWITCHING_CONTRACT_VIOLATION" : "EXPECTED_DECODER_RECONFIGURATION");
  compare(differences, "timescale", sourceTrack?.timescale ?? input.source.timescale, targetTrack?.timescale ?? input.target.timescale, input.sameAdaptationSet ? "SWITCHING_CONTRACT_VIOLATION" : "UNKNOWN");
  compare(differences, "dimensions.width", codedWidth(sourceTrack), codedWidth(targetTrack), "EXPECTED_RESOLUTION_SWITCH");
  compare(differences, "dimensions.height", codedHeight(sourceTrack), codedHeight(targetTrack), "EXPECTED_RESOLUTION_SWITCH");
  compare(differences, "pasp", json(firstEntry(sourceTrack)?.pasp), json(firstEntry(targetTrack)?.pasp), "EXPECTED_DECODER_RECONFIGURATION");
  compare(differences, "clap", json(firstEntry(sourceTrack)?.clap), json(firstEntry(targetTrack)?.clap), "EXPECTED_DECODER_RECONFIGURATION");
  compare(differences, "colr", json(firstEntry(sourceTrack)?.colr), json(firstEntry(targetTrack)?.colr), "RISKY_DECODER_RECONFIGURATION");
  compare(differences, "hvcC.profile", input.source.hevc?.generalProfileIdc, input.target.hevc?.generalProfileIdc, "RISKY_DECODER_RECONFIGURATION");
  compare(differences, "hvcC.tier", input.source.hevc?.generalTierFlag, input.target.hevc?.generalTierFlag, "EXPECTED_DECODER_RECONFIGURATION");
  compare(differences, "hvcC.level", input.source.hevc?.generalLevelIdc, input.target.hevc?.generalLevelIdc, "EXPECTED_DECODER_RECONFIGURATION");
  compare(differences, "hvcC.profileCompatibilityFlags", input.source.hevc?.generalProfileCompatibilityFlags, input.target.hevc?.generalProfileCompatibilityFlags, "RISKY_DECODER_RECONFIGURATION");
  compare(differences, "hvcC.constraintIndicatorFlags", input.source.hevc?.generalConstraintIndicatorFlags, input.target.hevc?.generalConstraintIndicatorFlags, "RISKY_DECODER_RECONFIGURATION");
  compare(differences, "hvcC.bitDepthLumaMinus8", input.source.hevc?.bitDepthLumaMinus8, input.target.hevc?.bitDepthLumaMinus8, "RISKY_DECODER_RECONFIGURATION");
  compare(differences, "hvcC.bitDepthChromaMinus8", input.source.hevc?.bitDepthChromaMinus8, input.target.hevc?.bitDepthChromaMinus8, "RISKY_DECODER_RECONFIGURATION");
  compare(differences, "hvcC.chromaFormat", input.source.hevc?.chromaFormat, input.target.hevc?.chromaFormat, "RISKY_DECODER_RECONFIGURATION");
  compare(differences, "hvcC.nalLengthSize", input.source.nalLengthSize, input.target.nalLengthSize, "RISKY_DECODER_RECONFIGURATION");
  compare(differences, "editLists", json(sourceTrack?.editList), json(targetTrack?.editList), "EXPECTED_DECODER_RECONFIGURATION");
  compare(differences, "trex", json(input.source.trex), json(input.target.trex), input.contract?.bitstreamSwitching ? "SWITCHING_CONTRACT_VIOLATION" : "EXPECTED_DECODER_RECONFIGURATION");
  compare(differences, "drm.schemes", json(input.source.drm.schemes), json(input.target.drm.schemes), "DRM_REINITIALIZATION");
  compare(differences, "drm.defaultKid", input.source.drm.tenc[0]?.defaultKid, input.target.drm.tenc[0]?.defaultKid, "DRM_REINITIALIZATION");
  const parameterSets = diffParameterSets(input.parameterSetEvidenceId, input.source.hevc?.parameterSets ?? [], input.target.hevc?.parameterSets ?? []);
  for (const change of parameterSets.changes) differences.push({ path: change.path, ...optionalValue("from", change.from), ...optionalValue("to", change.to), classification: impactClassification(change.impact) });
  const classifications = [...new Set(differences.map((difference) => difference.classification))];
  return {
    evidenceId: input.evidenceId,
    binaryEqual: input.source.sha256 === input.target.sha256,
    changed: differences.length > 0,
    classifications: classifications.length > 0 ? classifications : ["NONE"],
    differences,
    parameterSets,
  };
}

export function diffParameterSets(evidenceId: string, source: ParameterSetEvidence[], target: ParameterSetEvidence[]): SemanticParameterSetDiff {
  const changes: SemanticParameterSetChange[] = [];
  const keys = new Set([...source, ...target].map(keyForParameterSet));
  for (const key of keys) {
    const left = source.find((entry) => keyForParameterSet(entry) === key);
    const right = target.find((entry) => keyForParameterSet(entry) === key);
    const prefix = (left?.nalType ?? right?.nalType ?? "parameter_set").toLowerCase();
    if (!left || !right) {
      changes.push({ path: `${prefix}[${left?.parameterSetId ?? right?.parameterSetId ?? "unknown"}]`, from: left?.rawSha256 ?? null, to: right?.rawSha256 ?? null, impact: "DECODER_RECONFIGURATION" });
      continue;
    }
    const fields = new Set([...Object.keys(left.parsedSemanticFields), ...Object.keys(right.parsedSemanticFields)]);
    for (const field of fields) {
      const from = scalar(left.parsedSemanticFields[field]); const to = scalar(right.parsedSemanticFields[field]);
      if (from === to) continue;
      changes.push({ path: `${prefix}.${field}`, ...optionalValue("from", from), ...optionalValue("to", to), impact: parameterImpact(field) });
    }
    if (fields.size === 0 && left.rawSha256 !== right.rawSha256) changes.push({ path: `${prefix}.rawSha256`, from: left.rawSha256, to: right.rawSha256, impact: "DECODER_CONFIGURATION" });
  }
  return { evidenceId, changed: changes.length > 0, changes };
}

function compare(differences: InitSemanticDiff["differences"], path: string, from: string | number | boolean | undefined, to: string | number | boolean | undefined, classification: InitDiffClassification): void {
  if (from === to) return;
  differences.push({ path, ...optionalValue("from", from ?? null), ...optionalValue("to", to ?? null), classification });
}
function primaryVideoTrack(init: Fmp4InitInspection): Fmp4TrackInspection | undefined { return init.tracks.find((track) => track.handlerType === "vide") ?? init.tracks[0]; }
function firstEntry(track: Fmp4TrackInspection | undefined): Fmp4TrackInspection["sampleEntries"][number] | undefined { return track?.sampleEntries[0]; }
function sampleEntry(track: Fmp4TrackInspection | undefined, init: Fmp4InitInspection): string | undefined { return firstEntry(track)?.codingName ?? init.fourcc; }
function codedWidth(track: Fmp4TrackInspection | undefined): number | undefined { return firstEntry(track)?.codedWidth ?? track?.tkhdWidth; }
function codedHeight(track: Fmp4TrackInspection | undefined): number | undefined { return firstEntry(track)?.codedHeight ?? track?.tkhdHeight; }
function json(value: unknown): string | undefined { return value === undefined ? undefined : JSON.stringify(value); }
function scalar(value: string | number | boolean | Array<number | boolean> | undefined): string | number | boolean | undefined { return Array.isArray(value) ? JSON.stringify(value) : value; }
function keyForParameterSet(entry: ParameterSetEvidence): string { return `${entry.nalType}:${entry.parameterSetId ?? entry.rawSha256}`; }
function parameterImpact(field: string): SemanticDiffImpact {
  if (/pic_width|pic_height|conf_win/.test(field)) return "DECODER_RECONFIGURATION";
  if (/dec_pic_buffering|reorder|latency|bit_depth|chroma|colour|transfer|matrix|profile|constraint/.test(field)) return "RISKY_DECODER_RECONFIGURATION";
  if (/level|parameter_set_id|video_parameter_set_id/.test(field)) return "DECODER_CONFIGURATION";
  return "DECODER_CONFIGURATION";
}
function impactClassification(impact: SemanticDiffImpact): InitDiffClassification { return impact === "RISKY_DECODER_RECONFIGURATION" ? "RISKY_DECODER_RECONFIGURATION" : impact === "SWITCHING_CONTRACT" ? "SWITCHING_CONTRACT_VIOLATION" : impact === "DRM" ? "DRM_REINITIALIZATION" : "EXPECTED_DECODER_RECONFIGURATION"; }
function optionalValue<K extends "from" | "to">(key: K, value: string | number | boolean | null | undefined): Partial<Record<K, string | number | boolean | null>> { return value === undefined ? {} : { [key]: value } as Partial<Record<K, string | number | boolean | null>>; }
