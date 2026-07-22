import { afterEach, describe, expect, it, vi } from "vitest";
import { StreamCollectionError } from "../../stream-tools/errors.js";
import type { InvestigationJobRepository } from "../ports/investigation-job.js";
import { createInvestigationWorker } from "./run-investigation.js";

const claimedJob = {
  id: "16f42db1-2a1a-4bca-b6a0-d1fef18770c8",
  attempts: 1,
  maxAttempts: 3,
  investigation: {
    id: "c56a4180-65aa-42ec-a945-5fd21dec0538",
    sourceUrl: "https://example.test/live/master.m3u8",
    problemDescription: "Playback freezes.",
  },
};

function createRepository(): InvestigationJobRepository {
  return {
    claimNext: vi.fn(async () => claimedJob),
    heartbeat: vi.fn(async () => true),
    transition: vi.fn(async () => undefined),
    recordEvidence: vi.fn(async () => undefined),
    complete: vi.fn(async () => undefined),
    fail: vi.fn(async () => "retrying" as const),
  };
}

const collector = {
  collectManifest: vi.fn(async () => ({
    requestedUrl: claimedJob.investigation.sourceUrl,
    finalUrl: claimedJob.investigation.sourceUrl,
    statusCode: 200,
    contentType: "application/vnd.apple.mpegurl",
    bytes: new TextEncoder().encode("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nvideo.m3u8"),
    inspection: { protocol: "hls" as const, kind: "master" as const, variantCount: 1 },
  })),
};

const artifactStore = {
  put: vi.fn(async () => ({ storageKey: "artifacts/case/manifest.m3u8", sizeBytes: 55 })),
  remove: vi.fn(async () => undefined),
};

describe("investigation worker", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("persists manifest evidence and completes with a deterministic report", async () => {
    const repository = createRepository();
    const worker = createInvestigationWorker({
      repository, collector, artifactStore, workerId: "worker-test", leaseMs: 30_000,
    });

    await expect(worker.runNext()).resolves.toBe(true);

    expect(repository.transition).toHaveBeenCalledTimes(3);
    expect(vi.mocked(repository.transition).mock.calls.map((call) => call[3].state)).toEqual([
      "validating",
      "analyzing",
      "synthesizing",
    ]);
    expect(repository.recordEvidence).toHaveBeenCalledOnce();
    expect(repository.complete).toHaveBeenCalledWith(
      claimedJob.id,
      "worker-test",
      expect.any(String),
      expect.objectContaining({ placeholder: false, generatedBy: "deterministic-manifest-v1" }),
      expect.objectContaining({ type: "investigation.report_ready" }),
    );
    expect(repository.fail).not.toHaveBeenCalled();
  });

  it("returns idle without fabricating lifecycle events when no job is available", async () => {
    const repository = createRepository();
    vi.mocked(repository.claimNext).mockResolvedValueOnce(null);
    const worker = createInvestigationWorker({
      repository, collector, artifactStore, workerId: "worker-test", leaseMs: 30_000,
    });

    await expect(worker.runNext()).resolves.toBe(false);
    expect(repository.transition).not.toHaveBeenCalled();
    expect(repository.complete).not.toHaveBeenCalled();
  });

  it("returns a failed execution to the repository retry policy", async () => {
    const repository = createRepository();
    vi.mocked(repository.transition).mockRejectedValueOnce(new Error("database interrupted"));
    const worker = createInvestigationWorker({
      repository, collector, artifactStore, workerId: "worker-test", leaseMs: 30_000,
    });

    await expect(worker.runNext()).resolves.toBe(true);
    expect(repository.fail).toHaveBeenCalledWith(
      claimedJob.id,
      "worker-test",
      "WORKER_PIPELINE_FAILED",
      "database interrupted",
      true,
    );
    expect(repository.complete).not.toHaveBeenCalled();
  });

  it("does not retry a destination blocked by the network policy", async () => {
    const repository = createRepository();
    const blockedCollector = {
      collectManifest: vi.fn(async () => Promise.reject(new StreamCollectionError(
        "STREAM_DESTINATION_BLOCKED",
        "The stream destination is not a public network address",
        false,
      ))),
    };
    const worker = createInvestigationWorker({
      repository,
      collector: blockedCollector,
      artifactStore,
      workerId: "worker-test",
      leaseMs: 30_000,
    });

    await expect(worker.runNext()).resolves.toBe(true);
    expect(repository.fail).toHaveBeenCalledWith(
      claimedJob.id,
      "worker-test",
      "STREAM_DESTINATION_BLOCKED",
      "The stream destination is not a public network address",
      false,
    );
    expect(artifactStore.put).not.toHaveBeenCalled();
  });

  it("removes a stored file when artifact metadata cannot be committed", async () => {
    const repository = createRepository();
    vi.mocked(repository.recordEvidence).mockRejectedValueOnce(new Error("artifact transaction failed"));
    const worker = createInvestigationWorker({
      repository, collector, artifactStore, workerId: "worker-test", leaseMs: 30_000,
    });

    await expect(worker.runNext()).resolves.toBe(true);
    expect(artifactStore.remove).toHaveBeenCalledWith("artifacts/case/manifest.m3u8");
    expect(repository.fail).toHaveBeenCalledWith(
      claimedJob.id,
      "worker-test",
      "WORKER_PIPELINE_FAILED",
      "artifact transaction failed",
      true,
    );
  });

  it("renews the lease while a lifecycle stage is still running", async () => {
    vi.useFakeTimers();
    const repository = createRepository();
    let releaseStage: (() => void) | undefined;
    vi.mocked(repository.transition).mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        releaseStage = resolve;
      });
    });
    const worker = createInvestigationWorker({
      repository,
      collector,
      artifactStore,
      workerId: "worker-test",
      leaseMs: 3_000,
      heartbeatMs: 1_000,
    });

    const execution = worker.runNext();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(repository.heartbeat).toHaveBeenCalledWith(claimedJob.id, "worker-test", 3_000);
    releaseStage?.();
    await execution;
    expect(repository.complete).toHaveBeenCalledOnce();
  });
});
