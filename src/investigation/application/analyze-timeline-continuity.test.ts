import { describe, expect, it } from "vitest";
import { analyzeTimelineContinuity } from "./analyze-timeline-continuity.js";
import type { MediaSample } from "../ports/media-sample-collector.js";

function sample(logicalKey: string, sampleIndex: number, sequence: number, firstPts: number, lastPts: number): MediaSample {
  return {
    logicalKey,
    kind: "media-segment",
    sourceManifestLogicalKey: "manifest/variant/0",
    sampleIndex,
    sequence,
    probe: { tracks: [{ kind: "video", firstPts, lastPts }] },
    content: { bytes: new Uint8Array(0) },
  };
}

describe("analyzeTimelineContinuity", () => {
  it("reports presentation gaps between contiguous chunks", () => {
    const result = analyzeTimelineContinuity([
      sample("sample/variant/0/media/0", 0, 100, 0, 4),
      sample("sample/variant/0/media/1", 1, 101, 4.5, 8.5),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]?.continuous).toBe(false);
    expect(result[0]?.gaps).toEqual([
      expect.objectContaining({ fromSequence: 100, toSequence: 101, presentationGapMs: 500 }),
    ]);
    expect(result[0]?.totalGapMs).toBe(500);
  });

  it("reports overlaps when the next chunk starts before the previous ends", () => {
    const result = analyzeTimelineContinuity([
      sample("sample/variant/0/media/0", 0, 100, 0, 4),
      sample("sample/variant/0/media/1", 1, 101, 3.9, 7.9),
    ]);

    expect(result[0]?.gaps).toEqual([expect.objectContaining({ presentationOverlapMs: 100 })]);
    expect(result[0]?.continuous).toBe(false);
  });

  it("ignores non-contiguous sampled pairs from sample mode", () => {
    const result = analyzeTimelineContinuity([
      sample("sample/variant/0/media/0", 0, 100, 0, 4),
      sample("sample/variant/0/media/5", 5, 105, 24, 28),
    ]);

    expect(result[0]?.continuous).toBe(true);
    expect(result[0]?.gaps).toEqual([]);
  });

  it("treats aligned windows without probes as continuous by lack of facts", () => {
    const samples: MediaSample[] = [
      { logicalKey: "sample/variant/0/media/0", kind: "media-segment", sourceManifestLogicalKey: "manifest/variant/0", sampleIndex: 0, sequence: 0, content: { bytes: new Uint8Array(0) } },
      { logicalKey: "sample/variant/0/media/1", kind: "media-segment", sourceManifestLogicalKey: "manifest/variant/0", sampleIndex: 1, sequence: 1, content: { bytes: new Uint8Array(0) } },
    ];

    const result = analyzeTimelineContinuity(samples);

    expect(result[0]?.continuous).toBe(true);
    expect(result[0]?.gaps).toEqual([]);
  });
});
