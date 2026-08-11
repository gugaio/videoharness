import { describe, expect, it } from "vitest";
import type { BoundaryEvidence, HttpRequestEvidence } from "../domain/evidence.js";
import { AbrSwitchCorrelator, type RepresentationDiagnosticMaterial } from "./abr-switch-correlator.js";

describe("AbrSwitchCorrelator", () => {
  it("creates one AbrSwitchEvidence per actual Representation transition and attaches the target INIT", () => {
    const requests: HttpRequestEvidence[] = [
      request("http:uhd:10", "video", "uhd", 10, 1_000),
      request("http:init:fhd", "init", "fhd", undefined, 1_100),
      request("http:fhd:11", "video", "fhd", 11, 1_200),
      request("http:fhd:12", "video", "fhd", 12, 1_300),
    ];
    const representations = new Map<string, RepresentationDiagnosticMaterial>([
      ["uhd", material("uhd", 3840, 2160, 10)],
      ["fhd", material("fhd", 1920, 1080, 11)],
    ]);
    const switches = new AbrSwitchCorrelator().correlate({
      sessionId: "session-1",
      switchingContract: { evidenceId: "contract", mode: "GENERAL_REINITIALIZATION", segmentAlignment: true, startWithSap: 1, codecFamily: "HEVC", representations: ["uhd", "fhd"] },
      httpRequests: requests,
      representations,
    });
    expect(switches).toHaveLength(1);
    expect(switches[0]).toMatchObject({ direction: "DOWNSHIFT", switchKind: "RESOLUTION_CHANGING", timestamps: { sourceLastRequestMs: 1_000, targetInitRequestMs: 1_100, targetFirstMediaRequestMs: 1_200 } });
    expect(switches[0]?.networkEvidence.requests.map((item) => item.evidenceId)).toEqual(["http:uhd:10", "http:init:fhd", "http:fhd:11", "http:fhd:12"]);
    expect(switches[0]?.sapEvidence).toMatchObject({ manifestClaim: 1, observedSapType: 1, compatible: true });
  });
});

function request(evidenceId: string, resourceKind: "video" | "init", representationId: string, mediaSequence: number | undefined, at: number): HttpRequestEvidence { return { evidenceId, captureSource: "PLAYBACK_REQUEST", url: `https://example.test/${representationId}/${mediaSequence ?? "init"}`, resourceKind, representationId, requestStartMs: at, requestEndMs: at + 50, status: 200, downloadedBytes: 1_000, completed: true, ...(mediaSequence === undefined ? {} : { mediaSequence }) }; }
function material(id: string, width: number, height: number, sequence: number): RepresentationDiagnosticMaterial { return { summary: { evidenceId: `rep:${id}`, id, periodIndex: 0, adaptationSetIndex: 0, width, height, bandwidth: width * height }, segments: [{ mediaSequence: sequence, boundary: boundary(id, sequence), timeline: { timescale: 1_000, samples: [{ dts: sequence * 1_000, pts: sequence * 1_000, duration: 1_000 }] } }] }; }
function boundary(id: string, sequence: number): BoundaryEvidence { return { evidenceId: `boundary:${id}:${sequence}`, representationId: id, segmentNumber: sequence, accessUnits: [{ evidenceId: `au:${id}:${sequence}:0`, index: 0, dts: String(sequence * 1_000), pts: String(sequence * 1_000), duration: "1000", nalTypes: ["IDR_W_RADL"], firstVclNalType: "IDR_W_RADL", isIrap: true, irapType: "IDR_W_RADL", hasVpsBeforeFirstVcl: false, hasSpsBeforeFirstVcl: false, hasPpsBeforeFirstVcl: false, parameterSetIdsReferenced: {}, containsRasl: false, containsRadl: false }] }; }
