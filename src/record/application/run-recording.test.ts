import { describe, expect, it, vi } from "vitest";
import type { ClaimedRecordingJob } from "../domain/recording-job.js";
import type { RecordingJobRepository } from "../ports/recording-job.js";
import type { RecordingMaterializer } from "../ports/recording-materializer.js";
import type { RecordingStore } from "../ports/recording-store.js";
import { createRecordingWorker } from "./run-recording.js";

const job: ClaimedRecordingJob = {
  id: "8dc67e09-4b25-4fe5-a69a-58f896fb5197", attempts: 1, maxAttempts: 3,
  recording: { id: "c56a4180-65aa-42ec-a945-5fd21dec0538", sourceUrl: "https://example.test/master.m3u8", protocol: "hls", requestedDurationSeconds: 120, requestedStartSeconds: 0 },
};

describe("RecordingWorker", () => {
  it("only marks a recording ready after materialization and atomic publication", async () => {
    const repository: RecordingJobRepository = {
      claimNext: vi.fn(async () => job), heartbeat: vi.fn(async () => true), transition: vi.fn(async () => undefined),
      complete: vi.fn(async () => undefined), fail: vi.fn(async () => "failed" as const),
    };
    const workspace = { recordingId: job.recording.id, path: "/private/recording" };
    const store: RecordingStore = {
      prepareWorkspace: vi.fn(async () => workspace), publish: vi.fn(async () => undefined),
      discardWorkspace: vi.fn(async () => undefined), removePublished: vi.fn(async () => undefined),
    };
    const materializer: RecordingMaterializer = { materialize: vi.fn(async () => ({ coverageSeconds: 120, totalBytes: 4096, resources: [] })) };
    const worker = createRecordingWorker({ repository, store, materializer, workerId: "worker-a", leaseMs: 60_000 });

    await expect(worker.runNext()).resolves.toBe(true);

    expect(repository.transition).toHaveBeenCalledTimes(2);
    expect(materializer.materialize).toHaveBeenCalledWith(expect.objectContaining({ job, workspace, onProgress: expect.any(Function) }));
    expect(store.publish).toHaveBeenCalledWith(workspace);
    expect(repository.complete).toHaveBeenCalledWith(job.id, "worker-a", { coverageSeconds: 120, totalBytes: 4096, resources: [] }, expect.objectContaining({ type: "recording.ready" }));
    expect(repository.fail).not.toHaveBeenCalled();
  });

  it("removes an already-published recording when committing its state fails", async () => {
    const repository: RecordingJobRepository = {
      claimNext: vi.fn(async () => job), heartbeat: vi.fn(async () => true), transition: vi.fn(async () => undefined),
      complete: vi.fn(async () => { throw new Error("database unavailable"); }), fail: vi.fn(async () => "retrying" as const),
    };
    const workspace = { recordingId: job.recording.id, path: "/private/recording" };
    const store: RecordingStore = {
      prepareWorkspace: vi.fn(async () => workspace), publish: vi.fn(async () => undefined),
      discardWorkspace: vi.fn(async () => undefined), removePublished: vi.fn(async () => undefined),
    };
    const materializer: RecordingMaterializer = { materialize: vi.fn(async () => ({ coverageSeconds: 120, totalBytes: 4096, resources: [] })) };

    await createRecordingWorker({ repository, store, materializer, workerId: "worker-a", leaseMs: 60_000 }).runNext();

    expect(store.removePublished).toHaveBeenCalledWith(job.recording.id);
    expect(repository.fail).toHaveBeenCalledWith(job.id, "worker-a", "RECORDING_FAILED", "database unavailable", true);
  });
});
