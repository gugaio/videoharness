import { describe, expect, it, vi } from "vitest";
import type { RecordingIntakeRepository } from "../ports/recording-intake.js";
import { createStartRecording } from "./start-recording.js";

describe("startRecording", () => {
  it("normalizes the source and atomically requests a HLS recording job", async () => {
    const createOrGet = vi.fn<RecordingIntakeRepository["createOrGet"]>(async (input) => ({
      created: true,
      recording: {
        id: input.recordingId, sourceUrl: input.sourceUrl, protocol: "hls", state: "queued",
        requestedDurationSeconds: input.requestedDurationSeconds, requestedStartSeconds: input.requestedStartSeconds,
        createdAt: "2026-08-05T12:00:00.000Z", updatedAt: "2026-08-05T12:00:00.000Z",
      },
    }));
    const start = createStartRecording({ createOrGet });

    await start({ sourceUrl: "https://example.test/vod/master.m3u8", durationSeconds: 120, startSeconds: 10, idempotencyKey: "record-1" });

    expect(createOrGet).toHaveBeenCalledWith(expect.objectContaining({
      sourceUrl: "https://example.test/vod/master.m3u8",
      protocol: "hls", requestedDurationSeconds: 120, requestedStartSeconds: 10,
      idempotencyKey: "record-1", requestSignature: expect.stringMatching(/^[a-f0-9]{64}$/),
      initialEvent: expect.objectContaining({ type: "recording.created" }),
    }));
  });
});
