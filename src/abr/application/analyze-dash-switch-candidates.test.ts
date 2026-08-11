import { describe, expect, it } from "vitest";
import type { Fmp4InitInspection, HevcAccessUnitInspection } from "../../stream-tools/isobmff.js";
import { parseDashMpd } from "../../stream-tools/dash-mpd.js";
import type { MediaSample } from "../../investigation/ports/media-sample-collector.js";
import { analyzeDashSwitchCandidates } from "./analyze-dash-switch-candidates.js";

describe("analyzeDashSwitchCandidates", () => {
  it("creates URL-only candidates without pretending that a player transition was observed", () => {
    const dash = parseDashMpd(`<?xml version="1.0"?><MPD type="static" mediaPresentationDuration="PT12S"><Period duration="PT12S"><AdaptationSet id="video" contentType="video" codecs="hvc1" segmentAlignment="true" startWithSAP="1"><SegmentTemplate timescale="1000" duration="4000" initialization="$RepresentationID$-init.mp4" media="$RepresentationID$-$Number$.m4s"/><Representation id="uhd" bandwidth="16000000" width="3840" height="2160"/><Representation id="fhd" bandwidth="5000000" width="1920" height="1080"/></AdaptationSet></Period></MPD>`, "https://stream.example/manifest.mpd");
    const samples = [
      initSample("uhd"), initSample("fhd"),
      mediaSample("uhd", 1, 0, 4, 0, init("uhd", 3840, 2160)),
      mediaSample("uhd", 2, 4, 8, 4_000, init("uhd", 3840, 2160)),
      mediaSample("fhd", 1, 0, 4, 0, init("fhd", 1920, 1080)),
      mediaSample("fhd", 2, 4, 8, 4_000, init("fhd", 1920, 1080)),
    ];
    const switches = analyzeDashSwitchCandidates(dash, samples, {
      approximateTimeSeconds: 4,
      reportsVideoFreeze: true,
      reportsAudioContinues: true,
      reportsAbrSwitch: true,
      reportedAbrDirection: "DOWNSHIFT",
      reportedResolutionTransition: { sourceHeight: 2160, targetHeight: 1080 },
      reportedDevice: { manufacturer: "Samsung", modelCode: "QN90B", firmwareVersion: "1622.4", operatingSystem: "Tizen", playerName: "AVPlay" },
      mentionedPlayerEvents: ["PLAYER_MSG_RESOLUTION_CHANGED"],
      descriptionExcerpt: "Reported QN90B log excerpt.",
      uncertainties: [],
    });
    expect(switches).toHaveLength(2);
    const downshift = switches.find((entry) => entry.direction === "DOWNSHIFT")!;
    expect(downshift).toMatchObject({
      evidenceBasis: "URL_STATIC_ANALYSIS",
      transitionStatus: "CANDIDATE",
      switchKind: "RESOLUTION_CHANGING",
      timestamps: { candidateBoundaryPresentationTimeMs: 4_000 },
      reportedPlayerContext: { source: "problem_description", modelCode: "QN90B", firmwareVersion: "1622.4" },
      sapEvidence: { compatible: true, observedSapType: 1 },
      timelineEvidence: { videoDecodeGapMs: 0, videoDecodeOverlapMs: 0 },
    });
    expect(downshift.playerEvidence).toBeUndefined();
    expect(downshift.deviceCapabilityEvidence).toBeUndefined();
    expect(downshift.networkEvidence.requests.every((request) => request.captureSource === "INVESTIGATION_FETCH")).toBe(true);
    expect(downshift.missingEvidence).toContain("actual player Representation transition");
  });
});

function initSample(id: string): MediaSample { return { logicalKey: `sample/dash/${id}/init`, kind: "init-segment", sourceManifestLogicalKey: "manifest/root", representationId: id, source: { url: `https://stream.example/${id}-init.mp4`, sha256: id.padEnd(64, "0").slice(0, 64), httpStatus: 200, contentLength: 16 }, content: { bytes: new Uint8Array(16) } }; }

function mediaSample(id: string, sequence: number, start: number, end: number, dts: number, observedInit: Fmp4InitInspection): MediaSample {
  const accessUnit: HevcAccessUnitInspection = { nalTypes: ["SPS", "PPS", "IDR_W_RADL"], firstVclNalType: "IDR_W_RADL", isIrap: true, irapType: "IDR_W_RADL", hasVpsBeforeFirstVcl: false, hasSpsBeforeFirstVcl: true, hasPpsBeforeFirstVcl: true, parameterSetIdsReferenced: { vps: [], sps: [0], pps: [0] }, containsRasl: false, containsRadl: false };
  return {
    logicalKey: `sample/dash/${id}/media/${sequence}`, kind: "media-segment", sourceManifestLogicalKey: "manifest/root", representationId: id, sequence, presentationStartSeconds: start, presentationEndSeconds: end,
    source: { url: `https://stream.example/${id}-${sequence}.m4s`, sha256: `${id}${sequence}`.padEnd(64, "0").slice(0, 64), httpStatus: 200, contentLength: 32 }, content: { bytes: new Uint8Array(32) },
    probe: { tracks: [{ kind: "video", codec: "hevc", timeBase: "1/1000" }], fmp4: { init: observedInit, fragment: { sequenceNumber: sequence, baseMediaDecodeTime: String(dts), trafs: [], samples: [{ dts: String(dts), pts: String(dts), duration: "4000", size: 8, sync: true, nalTypes: [33, 34, 19], accessUnit, firstFrameKind: "idr" }], drmBoxTypes: [], structuralErrors: [] } } },
  };
}

function init(id: string, width: number, height: number): Fmp4InitInspection { return { sha256: id.padEnd(64, "a").slice(0, 64), fourcc: "hvc1", timescale: 1000, nalLengthSize: 4, tracks: [{ trackId: 1, tkhdWidth: width, tkhdHeight: height, timescale: 1000, handlerType: "vide", sampleEntries: [{ codingName: "hvc1", codedWidth: width, codedHeight: height }], editList: [] }], trex: [{ trackId: 1, defaultSampleDescriptionIndex: 1, defaultSampleDuration: 4000, defaultSampleSize: 0, defaultSampleFlags: 0 }], drm: { schemes: [], tenc: [], pssh: [] }, boxTypes: ["ftyp", "moov", "trak", "hvc1"], structuralErrors: [] }; }
