import { describe, expect, it } from "vitest";
import { buildFfprobeBoundarySummary, normalizeFfprobeEntries } from "./ffprobe-media-probe.js";

describe("FFprobe media evidence", () => {
  it("accepts FFprobe versions that interleave packets and frames", () => {
    const entries = normalizeFfprobeEntries({
      packets_and_frames: [
        { type: "packet", stream_index: 0, pts: 0, pts_time: "0", dts: 0, dts_time: "0", flags: "K_" },
        { type: "frame", media_type: "video", stream_index: 0, key_frame: 1, pict_type: "I", pts: 0, pts_time: "0" },
      ],
    });

    expect(entries.packets).toHaveLength(1);
    expect(entries.frames).toHaveLength(1);
    expect(entries.frames[0]).toMatchObject({ media_type: "video", pict_type: "I" });
  });

  it("groups video frames into compact GOP summaries", () => {
    const summary = buildFfprobeBoundarySummary(
      [{ stream_index: 0, pts: "0", pts_time: "0", dts: "0", dts_time: "0", flags: "K_" }],
      [
        { media_type: "audio", stream_index: 1, pts: "0", pts_time: "0" },
        { media_type: "video", stream_index: 0, key_frame: 1, pict_type: "I", pts: "0", pts_time: "0" },
        { media_type: "video", stream_index: 0, key_frame: 0, pict_type: "P", pts: "1", pts_time: "0.04" },
        { media_type: "video", stream_index: 0, key_frame: 0, pict_type: "B", pts: "2", pts_time: "0.08" },
        { media_type: "video", stream_index: 0, key_frame: 1, pict_type: "I", pts: "25", pts_time: "1" },
        { media_type: "video", stream_index: 0, key_frame: 0, pict_type: "P", pts: "26", pts_time: "1.04" },
      ],
    );

    expect(summary).toMatchObject({ totalPacketCount: 1, totalFrameCount: 5, totalGopCount: 2 });
    expect(summary.gops).toHaveLength(2);
    expect(summary.gops[0]).toMatchObject({ startFrameIndex: 0, frameCount: 3, startsWithKeyFrame: true, firstPtsTime: 0, lastPtsTime: 0.08, truncated: false });
    expect(summary.gops[0]?.frames.map((frame) => frame.pictureType)).toEqual(["I", "P", "B"]);
    expect(summary.gops[1]).toMatchObject({ startFrameIndex: 3, frameCount: 2, startsWithKeyFrame: true, firstPtsTime: 1, lastPtsTime: 1.04 });
  });
});
