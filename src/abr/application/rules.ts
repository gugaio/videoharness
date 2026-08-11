import type { AbrConfidence, AbrFindingCategory, AbrSeverity, AbrSwitchEvidence, DeterministicFinding } from "../domain/evidence.js";

export type AbrRuleOptions = {
  timelineToleranceMs?: number;
  significantAvSkewDeltaMs?: number;
};

/** Deterministic first pass. The LLM receives these findings; it does not create conformance facts. */
export function evaluateAbrSwitchRules(evidence: AbrSwitchEvidence, options: AbrRuleOptions = {}): DeterministicFinding[] {
  const findings: DeterministicFinding[] = [];
  const add = (ruleId: string, category: AbrFindingCategory, severity: AbrSeverity, title: string, explanation: string, evidenceIds: string[], confidence: AbrConfidence = "VERY_HIGH"): void => {
    findings.push({ evidenceId: `finding:${evidence.switchId}:${ruleId}`, ruleId, category, severity, confidence, title, explanation, evidenceIds: [...new Set(evidenceIds)] });
  };
  const sourceEntry = sampleEntry(evidence, "source");
  const targetEntry = sampleEntry(evidence, "target");
  const hevc = evidence.switchingContract.codecFamily === "HEVC" || /^(?:hvc1|hev1)/i.test(evidence.sourceRepresentation.codecs ?? evidence.targetRepresentation.codecs ?? "");
  const sameAdaptationSet = evidence.sourceRepresentation.periodIndex === evidence.targetRepresentation.periodIndex && evidence.sourceRepresentation.adaptationSetIndex === evidence.targetRepresentation.adaptationSetIndex;
  const sourceTrack = videoTrack(evidence.sourceInit);
  const targetTrack = videoTrack(evidence.targetInit);

  if (hevc && evidence.switchingContract.bitstreamSwitching === true && targetEntry !== "hev1") add("ABR_DASH_001", "SPEC_VIOLATION", "CRITICAL", "HEVC bitstream-switching contract requires hev1", `The MPD declares bitstreamSwitching=true but the observed target sample entry is ${targetEntry ?? "unknown"}.`, refs(evidence.switchingContract.evidenceId, evidence.targetInit?.evidenceId));
  if (evidence.switchingContract.bitstreamSwitching === true && sourceTrack?.trackId !== undefined && targetTrack?.trackId !== undefined && sourceTrack.trackId !== targetTrack.trackId) add("ABR_DASH_002", "SPEC_VIOLATION", "CRITICAL", "Track_ID changes in a bitstream-switching set", `Track_ID changes from ${sourceTrack.trackId} to ${targetTrack.trackId}.`, refs(evidence.sourceInit?.evidenceId, evidence.targetInit?.evidenceId));
  if (sameAdaptationSet && sourceEntry && targetEntry && sourceEntry !== targetEntry) add("ABR_DASH_003", "SPEC_VIOLATION", "CRITICAL", "Sample entry changes inside one AdaptationSet", `The observed sample entry changes from ${sourceEntry} to ${targetEntry}.`, refs(evidence.sourceInit?.evidenceId, evidence.targetInit?.evidenceId));
  const sourceTimescale = sourceTrack?.timescale ?? evidence.sourceInit?.timescale ?? evidence.sourceRepresentation.timescale;
  const targetTimescale = targetTrack?.timescale ?? evidence.targetInit?.timescale ?? evidence.targetRepresentation.timescale;
  if (sameAdaptationSet && sourceTimescale !== undefined && targetTimescale !== undefined && sourceTimescale !== targetTimescale) add("ABR_DASH_004", "SPEC_VIOLATION", evidence.switchingContract.bitstreamSwitching ? "CRITICAL" : "HIGH", "Media timescale changes inside one AdaptationSet", `The effective timescale changes from ${sourceTimescale} to ${targetTimescale}; continuity must be normalized and the declared switching contract is not satisfied.`, refs(evidence.switchingContract.evidenceId, evidence.sourceInit?.evidenceId, evidence.targetInit?.evidenceId));
  if ((evidence.sapEvidence?.manifestClaim === 1 || evidence.sapEvidence?.manifestClaim === 2) && evidence.sapEvidence.compatible === false) add("ABR_DASH_005", "SPEC_VIOLATION", "CRITICAL", "Observed boundary contradicts the MPD SAP claim", evidence.sapEvidence.reason, [evidence.sapEvidence.evidenceId]);

  const targetAccessUnit = evidence.targetBoundary?.accessUnits[0];
  if (targetAccessUnit && !targetAccessUnit.isIrap) add("ABR_HEVC_001", "AUTHORING_ERROR", "HIGH", "Target boundary is not an HEVC random-access point", `The first target VCL NAL is ${targetAccessUnit.firstVclNalType ?? "unknown"}, not an appropriate IRAP.`, [targetAccessUnit.evidenceId]);
  const initParameterSets = evidence.targetInit?.hevc?.parameterSets ?? [];
  if (hevc && evidence.switchingContract.bitstreamSwitching === true && targetEntry === "hev1" && targetAccessUnit && !(targetAccessUnit.hasSpsBeforeFirstVcl && targetAccessUnit.hasPpsBeforeFirstVcl) && !(initParameterSets.some((item) => item.nalType === "SPS") && initParameterSets.some((item) => item.nalType === "PPS"))) add("ABR_HEVC_002", "SPEC_VIOLATION", "CRITICAL", "Required HEVC parameter sets are unavailable at the target boundary", "Neither the target boundary nor its observed decoder configuration provides both SPS and PPS required to configure the target picture.", refs(targetAccessUnit.evidenceId, evidence.targetInit?.evidenceId));
  const codecContradiction = mpdCodecContradiction(evidence.targetRepresentation.codecs, evidence.targetInit);
  if (codecContradiction) add("ABR_HEVC_003", "AUTHORING_ERROR", "HIGH", "MPD codec signalling contradicts observed HEVC configuration", codecContradiction, refs(evidence.targetRepresentation.evidenceId, evidence.targetInit?.evidenceId));
  const colourChanges = evidence.initSemanticDiff?.differences.filter((difference) => difference.path === "colr" || /colour|transfer|matrix/.test(difference.path)) ?? [];
  if (sameAdaptationSet && colourChanges.length > 0) add("ABR_HEVC_004", "AUTHORING_RISK", "HIGH", "Colour signalling changes at the Representation switch", `Colour primaries, transfer characteristics or matrix signalling changes at ${colourChanges.map((item) => item.path).join(", ")}.`, refs(evidence.initSemanticDiff?.evidenceId));
  const bitDepthOrChroma = evidence.initSemanticDiff?.differences.filter((difference) => /bitDepth|chromaFormat|bit_depth|chroma_format/.test(difference.path)) ?? [];
  if (bitDepthOrChroma.length > 0) add("ABR_HEVC_005", "DECODER_RECONFIGURATION_RISK", "HIGH", "Bit depth or chroma format changes at the switch", "This is a risky decoder reconfiguration, not automatically a DASH/HEVC specification violation.", refs(evidence.initSemanticDiff?.evidenceId), "HIGH");

  const timeline = evidence.timelineEvidence;
  const tolerance = options.timelineToleranceMs ?? timeline?.toleranceMs ?? 2;
  if ((timeline?.videoDecodeGapMs ?? 0) > tolerance) add("ABR_TIME_001", "AUTHORING_ERROR", "HIGH", "Normalized video decode gap at the switch", `The video decode gap is ${timeline!.videoDecodeGapMs} ms after timescale/PTO/Period normalization.`, [timeline!.evidenceId]);
  if ((timeline?.videoDecodeOverlapMs ?? 0) > tolerance) add("ABR_TIME_002", "AUTHORING_ERROR", "HIGH", "Normalized video decode overlap at the switch", `The video decode overlap is ${timeline!.videoDecodeOverlapMs} ms after normalization.`, [timeline!.evidenceId]);
  if (Math.abs(timeline?.avSkewDeltaMs ?? 0) > (options.significantAvSkewDeltaMs ?? 80)) add("ABR_TIME_003", "AUTHORING_ERROR", "HIGH", "A/V skew changes materially at the switch", `A/V skew changes by ${timeline!.avSkewDeltaMs} ms at the boundary.`, [timeline!.evidenceId]);
  if ((timeline?.videoDecodeGapMs ?? 0) > tolerance || (timeline?.videoDecodeOverlapMs ?? 0) > tolerance) add("ABR_TIME_004", "AUTHORING_ERROR", "HIGH", "Target tfdt is inconsistent with decode continuity", `The normalized target decode time ${timeline?.actualTargetVideoDecodeTime ?? "unknown"} does not match the expected ${timeline?.expectedNextVideoDecodeTime ?? "unknown"}.`, refs(timeline?.evidenceId));

  const unexpectedDecoderChange = evidence.initSemanticDiff?.differences.some((difference) => difference.classification === "RISKY_DECODER_RECONFIGURATION")
    || evidence.initSemanticDiff?.parameterSets.changes.some((change) => change.impact === "RISKY_DECODER_RECONFIGURATION");
  if (evidence.initSemanticDiff?.changed && unexpectedDecoderChange) add("ABR_INIT_001", "DECODER_RECONFIGURATION_RISK", "HIGH", "INIT transition contains an unusual decoder-configuration change", "The semantic INIT diff contains a change classified as risky beyond the resolution/level/SPS updates expected during normal adaptive switching. This is a compatibility risk, not by itself a conformance violation.", [evidence.initSemanticDiff.evidenceId], "HIGH");
  const sourceKid = evidence.sourceInit?.drm.tenc[0]?.defaultKid; const targetKid = evidence.targetInit?.drm.tenc[0]?.defaultKid;
  if (sameAdaptationSet && sourceKid && targetKid && sourceKid !== targetKid) add("ABR_DRM_001", "DRM_TRANSITION", "CRITICAL", "default_KID changes unexpectedly inside one AdaptationSet", `The observed default_KID changes from ${sourceKid} to ${targetKid}.`, refs(evidence.sourceInit?.evidenceId, evidence.targetInit?.evidenceId));
  const device = evidence.deviceCapabilityEvidence;
  if (device && [device.codecSupported, device.profileSupported, device.levelSupported, device.resolutionSupported, device.frameRateSupported].includes(false)) add("ABR_DEVICE_001", "DEVICE_CAPABILITY_MISMATCH", "CRITICAL", "Target media exceeds the exact device capability", "At least one observed codec/profile/level/resolution/frame-rate requirement is unsupported by the identified device.", [device.evidenceId], device.source === "capability-database" ? "HIGH" : "MEDIUM");

  if (platformSuspected(evidence, findings)) add("ABR_PLATFORM_001", "PLATFORM_SUSPECTED", "HIGH", "Content checks pass but the identified player freezes at decoder reconfiguration", "Both representations decode independently, the boundary is random-access safe and continuous, conformance passes, target bytes complete, and the failure reproduces on an identified device/player version at the same reconfiguration.", refs(device?.evidenceId, evidence.playerEvidence?.evidenceId, evidence.networkEvidence.evidenceId, evidence.conformance?.evidenceId, ...evidence.decodeTests.map((test) => test.evidenceId)), "HIGH");
  return findings;
}

function sampleEntry(evidence: AbrSwitchEvidence, side: "source" | "target"): string | undefined { const init = side === "source" ? evidence.sourceInit : evidence.targetInit; const representation = side === "source" ? evidence.sourceRepresentation : evidence.targetRepresentation; return videoTrack(init)?.sampleEntries[0]?.codingName ?? init?.fourcc ?? representation.sampleEntry; }
function videoTrack(init: AbrSwitchEvidence["sourceInit"]): NonNullable<AbrSwitchEvidence["sourceInit"]>["tracks"][number] | undefined { return init?.tracks.find((track) => track.handlerType === "vide") ?? init?.tracks[0]; }
function refs(...values: Array<string | undefined>): string[] { return values.filter((value): value is string => value !== undefined); }
function mpdCodecContradiction(codecs: string | undefined, init: AbrSwitchEvidence["targetInit"]): string | undefined {
  if (!codecs || !init?.hevc) return undefined;
  const match = /^(?:hvc1|hev1)\.(\d+)[^.]*\.[^.]*\.L(\d+)/i.exec(codecs);
  if (!match) return undefined;
  const profile = Number(match[1]); const level = Number(match[2]);
  if (profile !== init.hevc.generalProfileIdc || level !== init.hevc.generalLevelIdc) return `MPD declares profile/level ${profile}/${level}, while hvcC observes ${init.hevc.generalProfileIdc}/${init.hevc.generalLevelIdc}.`;
  return undefined;
}
function platformSuspected(evidence: AbrSwitchEvidence, findings: DeterministicFinding[]): boolean {
  const decodePass = ["SOURCE_STANDALONE", "TARGET_STANDALONE", "TARGET_BOUNDARY"].every((test) => evidence.decodeTests.some((item) => item.test === test && item.status === "PASS"));
  const tolerance = evidence.timelineEvidence?.toleranceMs ?? 0;
  const safeBoundary = evidence.sapEvidence?.compatible === true && evidence.timelineEvidence !== undefined && (evidence.timelineEvidence.videoDecodeGapMs ?? 0) <= tolerance && (evidence.timelineEvidence.videoDecodeOverlapMs ?? 0) <= tolerance;
  const cleanRules = !findings.some((finding) => finding.category === "SPEC_VIOLATION" || finding.category === "AUTHORING_ERROR" || finding.category === "DEVICE_CAPABILITY_MISMATCH");
  const identifiedDevice = Boolean(evidence.deviceCapabilityEvidence?.modelCode && evidence.deviceCapabilityEvidence.firmwareVersion);
  const playerFreeze = evidence.playerEvidence?.events.some((event) => /bufferingstart|freeze|error/i.test(`${event.type} ${event.detail ?? ""}`)) ?? false;
  return decodePass && safeBoundary && cleanRules && evidence.conformance?.status === "PASS" && evidence.networkEvidence.targetInitCompletedBeforeSymptom === true && evidence.networkEvidence.targetMediaCompletedBeforeSymptom === true && identifiedDevice && playerFreeze;
}
