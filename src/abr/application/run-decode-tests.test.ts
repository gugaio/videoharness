import { describe, expect, it, vi } from "vitest";
import type { AbrSwitchEvidence } from "../domain/evidence.js";
import type { EvidenceBundleV2 } from "../../investigation/domain/evidence.js";
import type { MediaSample } from "../../investigation/ports/media-sample-collector.js";
import { attachPriorityAbrDecodeTests } from "./run-decode-tests.js";
import { buildAbrAssessment } from "./assess-stream-abr.js";

describe("attachPriorityAbrDecodeTests", () => {
  it("runs A/B/C and eligible D inputs for the risk-prioritized transition", async () => {
    const candidate = abrCandidate();
    const evidence: EvidenceBundleV2 = {
      schemaVersion: 2, collectedAt: "2026-08-08T12:00:00.000Z", source: { requestedUrl: "https://stream.example/manifest.mpd", finalUrl: "https://stream.example/manifest.mpd", protocol: "dash", httpStatus: 200 },
      manifests: [], mediaSamples: [], observations: [], limitations: [],
      abr: buildAbrAssessment({ protocol: "dash", representations: [{ evidenceId: "rep:uhd", id: "uhd", groupId: "dash:p0:a0", width: 3840, height: 2160 }, { evidenceId: "rep:fhd", id: "fhd", groupId: "dash:p0:a0", width: 1920, height: 1080 }], audioRenditionCount: 0, mediaSampleCount: 4, transitions: [candidate] }),
      dash: { type: "static", periods: [], adaptationSets: [], representations: [], limitations: [], switches: [candidate] },
    };
    const samples = [init("uhd", 1), init("fhd", 2), fragment("uhd", 10, 10), fragment("uhd", 11, 11), fragment("fhd", 11, 21), fragment("fhd", 12, 22)];
    const run = vi.fn(async () => [
      { evidenceId: "decode:source", test: "SOURCE_STANDALONE" as const, status: "PASS" as const, warnings: [] },
      { evidenceId: "decode:target", test: "TARGET_STANDALONE" as const, status: "PASS" as const, warnings: [] },
      { evidenceId: "decode:boundary", test: "TARGET_BOUNDARY" as const, status: "PASS" as const, warnings: [] },
      { evidenceId: "decode:switch", test: "SWITCHING_COMPATIBILITY" as const, status: "PASS" as const, warnings: [] },
    ]);

    await attachPriorityAbrDecodeTests(evidence, samples, { run });

    expect(run).toHaveBeenCalledWith(expect.objectContaining({ switchId: candidate.switchId, bitstreamSwitchingAllowed: true, sourceInit: Uint8Array.of(1), targetInit: Uint8Array.of(2), sourceFragments: [Uint8Array.of(10), Uint8Array.of(11)], targetFragments: [Uint8Array.of(21), Uint8Array.of(22)] }));
    expect(candidate.decodeTests).toHaveLength(4);
    expect(evidence.abr?.transitions[0]?.outcome).toBe("PASS");
    expect(candidate.missingEvidence).not.toContain("standalone and switching decode tests");
  });
});

function abrCandidate(): AbrSwitchEvidence { return { evidenceId: "switch", switchId: "uhd-to-fhd", evidenceBasis: "URL_STATIC_ANALYSIS", transitionStatus: "CANDIDATE", timestamps: {}, sourceRepresentation: { evidenceId: "rep:uhd", id: "uhd", periodIndex: 0, adaptationSetIndex: 0, width: 3840, height: 2160 }, targetRepresentation: { evidenceId: "rep:fhd", id: "fhd", periodIndex: 0, adaptationSetIndex: 0, width: 1920, height: 1080 }, direction: "DOWNSHIFT", switchKind: "RESOLUTION_CHANGING", switchingContract: { evidenceId: "contract", mode: "BITSTREAM_SWITCHING", bitstreamSwitching: true, codecFamily: "HEVC", representations: ["uhd", "fhd"] }, networkEvidence: { evidenceId: "network", requests: [] }, sourceBoundary: { evidenceId: "boundary:source", representationId: "uhd", segmentNumber: 11, accessUnits: [] }, targetBoundary: { evidenceId: "boundary:target", representationId: "fhd", segmentNumber: 11, accessUnits: [] }, decodeTests: [], deterministicFindings: [], missingEvidence: ["standalone and switching decode tests"] }; }
function init(representationId: string, byte: number): MediaSample { return { logicalKey: `${representationId}/init`, kind: "init-segment", sourceManifestLogicalKey: "manifest/root", representationId, content: { bytes: Uint8Array.of(byte) } }; }
function fragment(representationId: string, sequence: number, byte: number): MediaSample { return { logicalKey: `${representationId}/${sequence}`, kind: "media-segment", sourceManifestLogicalKey: "manifest/root", representationId, sequence, content: { bytes: Uint8Array.of(byte) } }; }
