import { afterEach, describe, expect, it, vi } from "vitest";
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
    complete: vi.fn(async () => undefined),
    fail: vi.fn(async () => "retrying" as const),
  };
}

describe("investigation worker", () => {
  afterEach(() => vi.useRealTimers());

  it("persists the ordered lifecycle and completes with an explicit fixture report", async () => {
    const repository = createRepository();
    const worker = createInvestigationWorker({ repository, workerId: "worker-test", leaseMs: 30_000 });

    await expect(worker.runNext()).resolves.toBe(true);

    expect(repository.transition).toHaveBeenCalledTimes(4);
    expect(vi.mocked(repository.transition).mock.calls.map((call) => call[3].state)).toEqual([
      "validating",
      "collecting",
      "analyzing",
      "synthesizing",
    ]);
    expect(repository.complete).toHaveBeenCalledWith(
      claimedJob.id,
      "worker-test",
      expect.any(String),
      expect.objectContaining({ placeholder: true, generatedBy: "phase-1-lifecycle-fixture" }),
      expect.objectContaining({ type: "investigation.report_ready" }),
    );
    expect(repository.fail).not.toHaveBeenCalled();
  });

  it("returns idle without fabricating lifecycle events when no job is available", async () => {
    const repository = createRepository();
    vi.mocked(repository.claimNext).mockResolvedValueOnce(null);
    const worker = createInvestigationWorker({ repository, workerId: "worker-test", leaseMs: 30_000 });

    await expect(worker.runNext()).resolves.toBe(false);
    expect(repository.transition).not.toHaveBeenCalled();
    expect(repository.complete).not.toHaveBeenCalled();
  });

  it("returns a failed execution to the repository retry policy", async () => {
    const repository = createRepository();
    vi.mocked(repository.transition).mockRejectedValueOnce(new Error("database interrupted"));
    const worker = createInvestigationWorker({ repository, workerId: "worker-test", leaseMs: 30_000 });

    await expect(worker.runNext()).resolves.toBe(true);
    expect(repository.fail).toHaveBeenCalledWith(
      claimedJob.id,
      "worker-test",
      "WORKER_PIPELINE_FAILED",
      "database interrupted",
    );
    expect(repository.complete).not.toHaveBeenCalled();
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
