import { describe, expect, it } from "vitest";
import type { AbrSwitchEvidence, InitSemanticDiff } from "../domain/evidence.js";
import type { Fmp4InitInspection, HevcDecoderConfiguration, ParameterSetEvidence } from "../../stream-tools/isobmff.js";
import { evaluateAbrSwitchRules } from "./rules.js";
import { TimelineNormalizer } from "./timeline-normalizer.js";

describe("ABR switch golden fixtures", () => {
  it("A. accepts a valid general HEVC resolution switch without a spec violation", () => {
    const evidence = fixture();
    evidence.initSemanticDiff = initDiff("EXPECTED_RESOLUTION_SWITCH", [{ path: "dimensions.width", from: 3840, to: 1920, classification: "EXPECTED_RESOLUTION_SWITCH" }]);
    expect(categories(evidence)).not.toContain("SPEC_VIOLATION");
  });

  it("A2. treats multiple expected SPS resolution/level changes as normal ABR", () => {
    const evidence = fixture();
    evidence.initSemanticDiff = {
      evidenceId: "init-diff", binaryEqual: false, changed: true,
      classifications: ["EXPECTED_RESOLUTION_SWITCH", "EXPECTED_DECODER_RECONFIGURATION"],
      differences: [
        { path: "dimensions.width", from: 3840, to: 1920, classification: "EXPECTED_RESOLUTION_SWITCH" },
        { path: "dimensions.height", from: 2160, to: 1080, classification: "EXPECTED_RESOLUTION_SWITCH" },
        { path: "hvcC.level", from: 150, to: 120, classification: "EXPECTED_DECODER_RECONFIGURATION" },
      ],
      parameterSets: { evidenceId: "parameter-diff", changed: true, changes: [
        { path: "sps.pic_width_in_luma_samples", from: 3840, to: 1920, impact: "DECODER_RECONFIGURATION" },
        { path: "sps.pic_height_in_luma_samples", from: 2160, to: 1080, impact: "DECODER_RECONFIGURATION" },
        { path: "sps.general_level_idc", from: 150, to: 120, impact: "DECODER_CONFIGURATION" },
      ] },
    };

    expect(ruleIds(evidence)).not.toContain("ABR_INIT_001");
    expect(evaluateAbrSwitchRules(evidence)).toHaveLength(0);
  });

  it("B. accepts valid hev1 bitstream switching with equal Track_ID and parameter sets", () => {
    const evidence = fixture({ bitstreamSwitching: true, sampleEntry: "hev1" });
    expect(ruleIds(evidence)).not.toEqual(expect.arrayContaining(["ABR_DASH_001", "ABR_DASH_002", "ABR_HEVC_002"]));
  });

  it("C. reports ABR_DASH_001 for bitstreamSwitching=true + hvc1", () => {
    expect(ruleIds(fixture({ bitstreamSwitching: true, sampleEntry: "hvc1" }))).toContain("ABR_DASH_001");
  });

  it("D. reports ABR_DASH_002 when Track_ID changes", () => {
    const evidence = fixture({ bitstreamSwitching: true, sampleEntry: "hev1" });
    evidence.targetInit!.tracks[0]!.trackId = 2;
    expect(ruleIds(evidence)).toContain("ABR_DASH_002");
  });

  it("E. reports ABR_DASH_003 for hvc1 -> hev1 inside one AdaptationSet", () => {
    const evidence = fixture();
    evidence.targetInit!.fourcc = "hev1"; evidence.targetInit!.tracks[0]!.sampleEntries[0]!.codingName = "hev1";
    expect(ruleIds(evidence)).toContain("ABR_DASH_003");
  });

  it("F. reports HEVC and DASH random-access failures", () => {
    const evidence = fixture(); const accessUnit = evidence.targetBoundary!.accessUnits[0]!;
    accessUnit.isIrap = false; delete accessUnit.irapType; accessUnit.firstVclNalType = "TRAIL_R";
    evidence.sapEvidence = { evidenceId: "sap", manifestClaim: 1, compatible: false, reason: "TRAIL_R is not SAP 1." };
    expect(ruleIds(evidence)).toEqual(expect.arrayContaining(["ABR_HEVC_001", "ABR_DASH_005"]));
  });

  it("G. reports ABR_HEVC_002 when hev1 target has no available SPS/PPS", () => {
    const evidence = fixture({ bitstreamSwitching: true, sampleEntry: "hev1" }); const accessUnit = evidence.targetBoundary!.accessUnits[0]!;
    accessUnit.hasSpsBeforeFirstVcl = false; accessUnit.hasPpsBeforeFirstVcl = false; evidence.targetInit!.hevc!.parameterSets = [];
    expect(ruleIds(evidence)).toContain("ABR_HEVC_002");
  });

  it("H. reports ABR_TIME_001 for a normalized 150 ms decode gap", () => {
    const evidence = fixture(); evidence.timelineEvidence!.videoDecodeGapMs = 150; evidence.timelineEvidence!.actualTargetVideoDecodeTime = 4.15;
    expect(ruleIds(evidence)).toContain("ABR_TIME_001");
  });

  it("I. reports ABR_TIME_003 when a continuous boundary introduces A/V skew", () => {
    const evidence = fixture(); evidence.timelineEvidence!.avSkewBeforeMs = 5; evidence.timelineEvidence!.avSkewAfterMs = 205; evidence.timelineEvidence!.avSkewDeltaMs = 200;
    expect(ruleIds(evidence)).toContain("ABR_TIME_003");
  });

  it("J. calls Main10 resolution/DPB changes a decoder risk, not a spec violation", () => {
    const evidence = fixture();
    evidence.initSemanticDiff = initDiff("RISKY_DECODER_RECONFIGURATION", [{ path: "sps.pic_width_in_luma_samples", from: 3840, to: 1920, classification: "EXPECTED_DECODER_RECONFIGURATION" }, { path: "sps.sps_max_dec_pic_buffering_minus1", from: "[5]", to: "[4]", classification: "RISKY_DECODER_RECONFIGURATION" }], 2);
    const findings = evaluateAbrSwitchRules(evidence);
    expect(findings).toContainEqual(expect.objectContaining({ ruleId: "ABR_INIT_001", category: "DECODER_RECONFIGURATION_RISK" }));
    expect(findings.filter((finding) => finding.category === "SPEC_VIOLATION")).toHaveLength(0);
  });

  it("K. reports PLATFORM_SUSPECTED only with exact device/player evidence and passing content checks", () => {
    const evidence = fixture();
    evidence.deviceCapabilityEvidence = { evidenceId: "device", manufacturer: "Example", modelCode: "Model-1", firmwareVersion: "1.2.3", operatingSystem: "ExampleOS", playerName: "ExamplePlayer", source: "observed", codecSupported: true, profileSupported: true, levelSupported: true, resolutionSupported: true, frameRateSupported: true };
    evidence.decodeTests = [decode("SOURCE_STANDALONE"), decode("TARGET_STANDALONE"), decode("TARGET_BOUNDARY")];
    evidence.conformance = { evidenceId: "dash-if", status: "PASS", findingEvidenceIds: [] };
    evidence.playerEvidence = { evidenceId: "player", playerName: "ExamplePlayer", events: [{ evidenceId: "player:buffer", type: "onbufferingstart", monotonicMs: 4_020, wallClockAt: "2026-08-08T12:00:04.020Z", representationId: "fhd" }] };
    expect(evaluateAbrSwitchRules(evidence)).toContainEqual(expect.objectContaining({ ruleId: "ABR_PLATFORM_001", category: "PLATFORM_SUSPECTED", confidence: "HIGH" }));
    delete evidence.deviceCapabilityEvidence;
    expect(ruleIds(evidence)).not.toContain("ABR_PLATFORM_001");
  });
});

describe("TimelineNormalizer", () => {
  it("normalizes tfdt across different timescales, PTO and Period start", () => {
    const result = new TimelineNormalizer().normalize({
      evidenceId: "timeline", toleranceMs: 2,
      sourceVideo: { timescale: 90_000, presentationTimeOffset: 90_000, periodStartSeconds: 10, samples: [{ dts: 360_000, pts: 360_000, duration: 90_000 }] },
      targetVideo: { timescale: 1_000, presentationTimeOffset: 1_000, periodStartSeconds: 10, samples: [{ dts: 5_150, pts: 5_150, duration: 1_000 }] },
    });
    expect(result.expectedNextVideoDecodeTime).toBe(14);
    expect(result.actualTargetVideoDecodeTime).toBe(14.15);
    expect(result.videoDecodeGapMs).toBeCloseTo(150);
  });
});

function fixture(options: { bitstreamSwitching?: boolean; sampleEntry?: "hvc1" | "hev1" } = {}): AbrSwitchEvidence {
  const sampleEntry = options.sampleEntry ?? "hvc1";
  return {
    evidenceId: "switch:1", switchId: "switch-1", evidenceBasis: "PLAYBACK_NETWORK_OBSERVED", transitionStatus: "OBSERVED", timestamps: { detectedAtMonotonicMs: 4_000 },
    sourceRepresentation: { evidenceId: "rep:uhd", id: "uhd", periodIndex: 0, adaptationSetIndex: 0, bandwidth: 16_000_000, codecs: `${sampleEntry}.2.4.L153.B0`, sampleEntry, width: 3840, height: 2160, timescale: 90_000 },
    targetRepresentation: { evidenceId: "rep:fhd", id: "fhd", periodIndex: 0, adaptationSetIndex: 0, bandwidth: 5_000_000, codecs: `${sampleEntry}.2.4.L153.B0`, sampleEntry, width: 1920, height: 1080, timescale: 90_000 },
    direction: "DOWNSHIFT", switchKind: "RESOLUTION_CHANGING",
    switchingContract: { evidenceId: "contract", mode: options.bitstreamSwitching ? "BITSTREAM_SWITCHING" : "GENERAL_REINITIALIZATION", ...(options.bitstreamSwitching === undefined ? {} : { bitstreamSwitching: options.bitstreamSwitching }), segmentAlignment: true, startWithSap: 1, effectiveTimescale: 90_000, presentationTimeOffset: "0", codecFamily: "HEVC", sampleEntryExpectation: sampleEntry, representations: ["uhd", "fhd"] },
    networkEvidence: { evidenceId: "network", requests: [], targetInitCompletedBeforeSymptom: true, targetMediaCompletedBeforeSymptom: true },
    sourceInit: init("source-init", sampleEntry, 3840, 2160), targetInit: init("target-init", sampleEntry, 1920, 1080),
    sourceBoundary: boundary("source-boundary", "uhd"), targetBoundary: boundary("target-boundary", "fhd"),
    sapEvidence: { evidenceId: "sap", manifestClaim: 1, observedSapType: 1, compatible: true, reason: "IDR satisfies SAP 1." },
    timelineEvidence: { evidenceId: "timeline", toleranceMs: 2, expectedNextVideoDecodeTime: 4, actualTargetVideoDecodeTime: 4, videoDecodeGapMs: 0, videoDecodeOverlapMs: 0, expectedNextVideoPresentationTime: 4, actualTargetVideoPresentationTime: 4, videoPresentationGapMs: 0, videoPresentationOverlapMs: 0, audioGapMs: 0, audioOverlapMs: 0, avSkewBeforeMs: 5, avSkewAfterMs: 5, avSkewDeltaMs: 0, sourceSegmentDurationMs: 4_000, targetSegmentDurationMs: 4_000 },
    decodeTests: [], deterministicFindings: [], missingEvidence: [],
  };
}
function init(evidenceId: string, fourcc: "hvc1" | "hev1", width: number, height: number): Fmp4InitInspection & { evidenceId: string } { const hevc = decoderConfig(); return { evidenceId, sha256: evidenceId.padEnd(64, "0").slice(0, 64), ftyp: { majorBrand: "iso6", compatibleBrands: ["iso6", "dash"] }, fourcc, timescale: 90_000, nalLengthSize: 4, hevc, tracks: [{ trackId: 1, tkhdWidth: width, tkhdHeight: height, timescale: 90_000, handlerType: "vide", sampleEntries: [{ codingName: fourcc, codedWidth: width, codedHeight: height, hevc }], editList: [] }], trex: [{ trackId: 1, defaultSampleDescriptionIndex: 1, defaultSampleDuration: 3_000, defaultSampleSize: 0, defaultSampleFlags: 0 }], drm: { schemes: [], tenc: [], pssh: [] }, boxTypes: ["ftyp", "moov", "trak", "hvcC"], structuralErrors: [] }; }
function decoderConfig(): HevcDecoderConfiguration { const sets = [parameterSet("SPS", 0), parameterSet("PPS", 0)]; return { rawSha256: "a".repeat(64), rawSize: 64, configurationVersion: 1, generalProfileSpace: 0, generalTierFlag: false, generalProfileIdc: 2, generalProfileCompatibilityFlags: 4, generalConstraintIndicatorFlags: "000000000000", generalLevelIdc: 153, minSpatialSegmentationIdc: 0, parallelismType: 0, chromaFormat: 1, bitDepthLumaMinus8: 2, bitDepthChromaMinus8: 2, avgFrameRate: 0, constantFrameRate: 0, numTemporalLayers: 1, temporalIdNested: true, lengthSizeMinusOne: 3, parameterSets: sets, profileIdc: 2, levelIdc: 153, tierFlag: false, bitDepthLuma: 10, bitDepthChroma: 10, parameterSetHashes: { sps: [sets[0]!.rawSha256], pps: [sets[1]!.rawSha256] } }; }
function parameterSet(nalType: "SPS" | "PPS", id: number): ParameterSetEvidence { return { nalType, parameterSetId: id, rawSha256: (nalType === "SPS" ? "b" : "c").repeat(64), rawSize: 24, parsedSemanticFields: nalType === "SPS" ? { sps_seq_parameter_set_id: id, pic_width_in_luma_samples: 1920, pic_height_in_luma_samples: 1080 } : { pps_pic_parameter_set_id: id, pps_seq_parameter_set_id: 0 } }; }
function boundary(evidenceId: string, representationId: string): NonNullable<AbrSwitchEvidence["targetBoundary"]> { return { evidenceId, representationId, segmentNumber: 1, accessUnits: [{ evidenceId: `${evidenceId}:au:0`, index: 0, pts: "0", dts: "0", duration: "3000", keyFrameAccordingToFfprobe: true, nalTypes: ["VPS", "SPS", "PPS", "IDR_W_RADL"], firstVclNalType: "IDR_W_RADL", isIrap: true, irapType: "IDR_W_RADL", hasVpsBeforeFirstVcl: true, hasSpsBeforeFirstVcl: true, hasPpsBeforeFirstVcl: true, parameterSetIdsReferenced: { vps: [0], sps: [0], pps: [0] }, containsRasl: false, containsRadl: false }] }; }
function initDiff(classification: InitSemanticDiff["classifications"][number], differences: InitSemanticDiff["differences"], parameterChangeCount = 0): InitSemanticDiff { return { evidenceId: "init-diff", binaryEqual: false, changed: true, classifications: [classification], differences, parameterSets: { evidenceId: "parameter-diff", changed: parameterChangeCount > 0, changes: Array.from({ length: parameterChangeCount }, (_, index) => ({ path: `sps.field_${index}`, from: index, to: index + 1, impact: "RISKY_DECODER_RECONFIGURATION" })) } }; }
function decode(test: "SOURCE_STANDALONE" | "TARGET_STANDALONE" | "TARGET_BOUNDARY"): AbrSwitchEvidence["decodeTests"][number] { return { evidenceId: `decode:${test}`, test, status: "PASS", exitCode: 0, decodedFrameCount: 120, warnings: [], corruptFrames: 0 }; }
function ruleIds(evidence: AbrSwitchEvidence): string[] { return evaluateAbrSwitchRules(evidence).map((finding) => finding.ruleId); }
function categories(evidence: AbrSwitchEvidence): string[] { return evaluateAbrSwitchRules(evidence).map((finding) => finding.category); }
