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
    claimNextAnalysis: vi.fn(async () => null),
    heartbeat: vi.fn(async () => true),
    transition: vi.fn(async () => undefined),
    recordEvidenceBatch: vi.fn(async () => ({ snapshotId: "8dc67e09-4b25-4fe5-a69a-58f896fb5197", supersededStorageKeys: [] })),
    recordAgentRuns: vi.fn(async () => undefined),
    loadLatestEvidence: vi.fn(async () => null),
    completeCollection: vi.fn(async () => undefined),
    complete: vi.fn(async () => undefined),
    fail: vi.fn(async () => "retrying" as const),
  };
}

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

const collector = {
  collect: vi.fn(async () => ({
    manifests: [{
      logicalKey: "manifest/root",
      role: "root" as const,
      source: {
        requestedUrl: claimedJob.investigation.sourceUrl,
        finalUrl: claimedJob.investigation.sourceUrl,
        statusCode: 200,
        contentType: "application/vnd.apple.mpegurl",
      },
      content: {
        bytes: new TextEncoder().encode("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nvideo.m3u8"),
      },
      inspection: { protocol: "hls" as const, kind: "master" as const, variantCount: 1 },
    }],
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

  it("persists manifest evidence and stops when deterministic evidence is ready", async () => {
    const repository = createRepository();
    const worker = createInvestigationWorker({
      repository, collector, artifactStore, workerId: "worker-test", leaseMs: 30_000,
    });

    await expect(worker.runNext()).resolves.toBe(true);

    expect(repository.transition).toHaveBeenCalledTimes(2);
    expect(vi.mocked(repository.transition).mock.calls.map((call) => call[3].state)).toEqual([
      "validating",
      "collecting",
    ]);
    expect(repository.recordEvidenceBatch).toHaveBeenCalledOnce();
    expect(repository.recordEvidenceBatch).toHaveBeenCalledWith(
      claimedJob.id,
      "worker-test",
      30_000,
      [expect.objectContaining({ logicalKey: "manifest/root", kind: "manifest" })],
      expect.objectContaining({ schemaVersion: 2, manifests: expect.any(Array), mediaSamples: [] }),
      expect.objectContaining({ type: "investigation.evidence_found" }),
    );
    expect(repository.completeCollection).toHaveBeenCalledWith(
      claimedJob.id,
      "worker-test",
      expect.objectContaining({ type: "investigation.evidence_ready", payload: expect.objectContaining({ state: "evidence_ready" }) }),
    );
    expect(repository.complete).not.toHaveBeenCalled();
    expect(repository.fail).not.toHaveBeenCalled();
  });

  it("publishes counted collection progress events while evidence is collected", async () => {
    const repository = createRepository();
    const progressCollector = {
      collect: vi.fn(async (_url: string, onProgress?: (p: { stage: string; message: string; completed?: number; total?: number }) => Promise<void>) => {
        await onProgress?.({ stage: "root_manifest", message: "Fetching the root manifest through the safe network boundary…" });
        await onProgress?.({ stage: "variant_manifest", message: "Fetching the selected video variant playlist…" });
        return {
          manifests: [{
            logicalKey: "manifest/root",
            role: "root" as const,
            source: {
              requestedUrl: claimedJob.investigation.sourceUrl,
              finalUrl: claimedJob.investigation.sourceUrl,
              statusCode: 200,
            },
            content: { bytes: new TextEncoder().encode("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nvideo.m3u8") },
            inspection: { protocol: "hls" as const, kind: "master" as const, variantCount: 1 },
          }],
        };
      }),
    };
    const progressMediaCollector = {
      collect: vi.fn(async (_collection: unknown, onProgress?: (p: { stage: string; message: string; completed?: number; total?: number }) => Promise<void>) => {
        await onProgress?.({ stage: "media_sample", message: "Sampling media segment 1 of 2 from manifest/variant/0…", completed: 0, total: 2 });
        await onProgress?.({ stage: "media_sample", message: "Sampling media segment 2 of 2 from manifest/variant/0…", completed: 1, total: 2 });
        return { samples: [], limitations: [] };
      }),
    };
    const mediaProbe = { probe: vi.fn() };
    const worker = createInvestigationWorker({
      repository,
      collector: progressCollector,
      artifactStore,
      mediaCollector: progressMediaCollector,
      mediaProbe,
      workerId: "worker-test",
      leaseMs: 30_000,
    });

    await expect(worker.runNext()).resolves.toBe(true);

    const events = vi.mocked(repository.transition).mock.calls.map((call) => call[3]);
    const states = events.map((transition) => transition.state);
    expect(states).toEqual(["validating", "collecting", "collecting", "collecting", "collecting", "collecting"]);
    const progressEvents = events
      .filter((transition) => transition.event.payload.stage === "collection")
      .map((transition) => transition.event.payload);
    expect(progressEvents).toEqual([
      { state: "collecting", stage: "collection", collectionStage: "root_manifest" },
      { state: "collecting", stage: "collection", collectionStage: "variant_manifest" },
      { state: "collecting", stage: "collection", collectionStage: "media_sample", completed: 0, total: 2 },
      { state: "collecting", stage: "collection", collectionStage: "media_sample", completed: 1, total: 2 },
    ]);
    expect(repository.completeCollection).toHaveBeenCalledOnce();
  });

  it("returns idle without fabricating lifecycle events when no job is available", async () => {
    const repository = createRepository();
    vi.mocked(repository.claimNext).mockResolvedValueOnce(null);
    const worker = createInvestigationWorker({
      repository, collector, artifactStore, workerId: "worker-test", leaseMs: 30_000,
    });

    await expect(worker.runNext()).resolves.toBe(false);
    expect(repository.transition).not.toHaveBeenCalled();
    expect(repository.completeCollection).not.toHaveBeenCalled();
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
    expect(repository.completeCollection).not.toHaveBeenCalled();
  });

  it("does not retry a destination blocked by the network policy", async () => {
    const repository = createRepository();
    const blockedCollector = {
      collect: vi.fn(async () => Promise.reject(new StreamCollectionError(
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

  it("promotes root and derived manifests in one evidence batch", async () => {
    const repository = createRepository();
    const rootBytes = new TextEncoder().encode("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2000\nvariant.m3u8");
    const variantBytes = new TextEncoder().encode("#EXTM3U\n#EXTINF:4,\nsegment.ts");
    const multiCollector = {
      collect: vi.fn(async () => ({
        manifests: [
          {
            logicalKey: "manifest/root",
            role: "root" as const,
            source: {
              requestedUrl: claimedJob.investigation.sourceUrl,
              finalUrl: claimedJob.investigation.sourceUrl,
              statusCode: 200,
            },
            content: { bytes: rootBytes },
            inspection: {
              protocol: "hls" as const,
              kind: "master" as const,
              variantCount: 1,
              hls: {
                kind: "master" as const,
                variants: [{
                  index: 0,
                  uri: "variant.m3u8",
                  url: "https://example.test/live/variant.m3u8",
                  bandwidth: 2_000,
                }],
                renditions: [],
                segmentCount: 0,
                discontinuityCount: 0,
                hasEndList: false,
              },
            },
          },
          {
            logicalKey: "manifest/variant/0",
            role: "variant" as const,
            source: {
              requestedUrl: "https://example.test/live/variant.m3u8",
              finalUrl: "https://example.test/live/variant.m3u8",
              statusCode: 200,
            },
            content: { bytes: variantBytes },
            inspection: {
              protocol: "hls" as const,
              kind: "media" as const,
              segmentCount: 1,
              hls: {
                kind: "media" as const,
                variants: [],
                renditions: [],
                segmentCount: 1,
                discontinuityCount: 0,
                hasEndList: false,
              },
            },
          },
        ],
        hlsSelection: {
          rule: "highest-bandwidth" as const,
          variant: {
            index: 0,
            uri: "variant.m3u8",
            url: "https://example.test/live/variant.m3u8",
            bandwidth: 2_000,
          },
        },
      })),
    };
    const uniqueArtifactStore = {
      put: vi.fn(async (input: { artifactId: string; content: Uint8Array }) => ({
        storageKey: `artifacts/case/${input.artifactId}.m3u8`,
        sizeBytes: input.content.byteLength,
      })),
      remove: vi.fn(async () => undefined),
    };
    const worker = createInvestigationWorker({
      repository,
      collector: multiCollector,
      artifactStore: uniqueArtifactStore,
      workerId: "worker-test",
      leaseMs: 30_000,
    });

    await expect(worker.runNext()).resolves.toBe(true);

    expect(uniqueArtifactStore.put).toHaveBeenCalledTimes(2);
    expect(repository.recordEvidenceBatch).toHaveBeenCalledWith(
      claimedJob.id,
      "worker-test",
      30_000,
      expect.arrayContaining([
        expect.objectContaining({ logicalKey: "manifest/root" }),
        expect.objectContaining({ logicalKey: "manifest/variant/0" }),
      ]),
      expect.objectContaining({
        schemaVersion: 2,
        manifests: expect.arrayContaining([
          expect.objectContaining({ logicalKey: "manifest/variant/0", segmentCount: 1 }),
        ]),
        hls: expect.objectContaining({
          selection: expect.objectContaining({ variantIndex: 0, variantLogicalKey: "manifest/variant/0" }),
        }),
      }),
      expect.objectContaining({ type: "investigation.evidence_found" }),
    );
  });

  it("points the HLS selection to the highest-bandwidth variant, not the first collected", async () => {
    const repository = createRepository();
    const ladderCollector = {
      collect: vi.fn(async () => ({
        manifests: [
          {
            logicalKey: "manifest/root",
            role: "root" as const,
            source: {
              requestedUrl: claimedJob.investigation.sourceUrl,
              finalUrl: claimedJob.investigation.sourceUrl,
              statusCode: 200,
            },
            content: { bytes: new TextEncoder().encode("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nlow.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2000\nhigh.m3u8") },
            inspection: {
              protocol: "hls" as const,
              kind: "master" as const,
              variantCount: 2,
              hls: {
                kind: "master" as const,
                variants: [
                  { index: 0, uri: "low.m3u8", url: "https://example.test/live/low.m3u8", bandwidth: 1_000 },
                  { index: 1, uri: "high.m3u8", url: "https://example.test/live/high.m3u8", bandwidth: 2_000 },
                ],
                renditions: [],
                segmentCount: 0,
                discontinuityCount: 0,
                hasEndList: false,
              },
            },
          },
          {
            logicalKey: "manifest/variant/0",
            role: "variant" as const,
            source: { requestedUrl: "https://example.test/live/low.m3u8", finalUrl: "https://example.test/live/low.m3u8", statusCode: 200 },
            content: { bytes: new TextEncoder().encode("#EXTM3U\n#EXTINF:4,\nlow.ts") },
            inspection: { protocol: "hls" as const, kind: "media" as const, segmentCount: 1, hls: { kind: "media" as const, variants: [], renditions: [], segmentCount: 1, discontinuityCount: 0, hasEndList: false } },
          },
          {
            logicalKey: "manifest/variant/1",
            role: "variant" as const,
            source: { requestedUrl: "https://example.test/live/high.m3u8", finalUrl: "https://example.test/live/high.m3u8", statusCode: 200 },
            content: { bytes: new TextEncoder().encode("#EXTM3U\n#EXTINF:4,\nhigh.ts") },
            inspection: { protocol: "hls" as const, kind: "media" as const, segmentCount: 1, hls: { kind: "media" as const, variants: [], renditions: [], segmentCount: 1, discontinuityCount: 0, hasEndList: false } },
          },
        ],
        hlsSelection: {
          rule: "highest-bandwidth" as const,
          variant: { index: 1, uri: "high.m3u8", url: "https://example.test/live/high.m3u8", bandwidth: 2_000 },
        },
        mediaSamples: [{
          logicalKey: "sample/variant/1/media/0",
          kind: "media-segment" as const,
          sourceManifestLogicalKey: "manifest/variant/1",
          sampleIndex: 0,
          content: { bytes: new TextEncoder().encode("segment") },
        }],
      })),
    };
    const worker = createInvestigationWorker({
      repository,
      collector: ladderCollector,
      artifactStore,
      workerId: "worker-test",
      leaseMs: 30_000,
    });

    await expect(worker.runNext()).resolves.toBe(true);

    expect(repository.recordEvidenceBatch).toHaveBeenCalledWith(
      claimedJob.id,
      "worker-test",
      30_000,
      expect.anything(),
      expect.objectContaining({
        hls: expect.objectContaining({
          selection: expect.objectContaining({
            variantIndex: 1,
            variantLogicalKey: "manifest/variant/1",
            sampledVariants: [{ index: 1, logicalKey: "manifest/variant/1" }],
          }),
        }),
      }),
      expect.anything(),
    );
  });

  it("removes a stored file when artifact metadata cannot be committed", async () => {
    const repository = createRepository();
    vi.mocked(repository.recordEvidenceBatch).mockRejectedValueOnce(new Error("artifact transaction failed"));
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

  it("removes the superseded artifact only after the replacement metadata is committed", async () => {
    const repository = createRepository();
    vi.mocked(repository.recordEvidenceBatch).mockResolvedValueOnce({
      snapshotId: "8dc67e09-4b25-4fe5-a69a-58f896fb5197",
      supersededStorageKeys: ["artifacts/case/previous.m3u8"],
    });
    const worker = createInvestigationWorker({
      repository, collector, artifactStore, workerId: "worker-test", leaseMs: 30_000,
    });

    await expect(worker.runNext()).resolves.toBe(true);

    expect(artifactStore.remove).toHaveBeenCalledWith("artifacts/case/previous.m3u8");
    expect(artifactStore.remove).not.toHaveBeenCalledWith("artifacts/case/manifest.m3u8");
    expect(repository.completeCollection).toHaveBeenCalledOnce();
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
    expect(repository.completeCollection).toHaveBeenCalledOnce();
  });

  it("logs claimed, stage changes and evidence_ready without logging the source URL", async () => {
    const repository = createRepository();
    const logger = createLogger();
    const worker = createInvestigationWorker({
      repository, collector, artifactStore, workerId: "worker-test", leaseMs: 30_000, logger,
    });

    await expect(worker.runNext()).resolves.toBe(true);

    expect(logger.info).toHaveBeenCalledWith("worker.job_claimed", expect.objectContaining({
      jobId: claimedJob.id,
      jobKind: "investigation",
      investigationId: claimedJob.investigation.id,
      attempt: 1,
      maxAttempts: 3,
    }));
    expect(logger.info).toHaveBeenCalledWith("investigation.state_changed", expect.objectContaining({ state: "validating" }));
    expect(logger.info).toHaveBeenCalledWith("investigation.state_changed", expect.objectContaining({ state: "collecting" }));
    expect(logger.info).toHaveBeenCalledWith("investigation.evidence_ready", expect.objectContaining({
      protocol: "hls",
      manifestCount: 1,
      mediaSampleCount: 0,
      probeCount: 0,
      snapshotId: "8dc67e09-4b25-4fe5-a69a-58f896fb5197",
    }));
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("example.test");
  });

  it("logs collection limitations and terminal failures as structured events", async () => {
    const repository = createRepository();
    const logger = createLogger();
    const progressCollector = {
      collect: vi.fn(async (_url: string, onProgress?: (p: {
        stage: string;
        message: string;
        limitation?: { errorCode: string; resourceKind: string; logicalKey?: string };
      }) => Promise<void>) => {
        await onProgress?.({
          stage: "media_sample",
          message: "A media segment could not be sampled.",
          limitation: { errorCode: "STREAM_REQUEST_TIMEOUT", resourceKind: "media_segment", logicalKey: "manifest/variant/0" },
        });
        throw new StreamCollectionError("STREAM_DESTINATION_BLOCKED", "The stream destination is not a public network address", false);
      }),
    };
    const worker = createInvestigationWorker({
      repository,
      collector: progressCollector,
      artifactStore,
      workerId: "worker-test",
      leaseMs: 30_000,
      logger,
    });

    await expect(worker.runNext()).resolves.toBe(true);

    expect(logger.warn).toHaveBeenCalledWith("investigation.collection_limited", expect.objectContaining({
      stage: "media_sample",
      errorCode: "STREAM_REQUEST_TIMEOUT",
      resourceKind: "media_segment",
      logicalKey: "manifest/variant/0",
    }));
    expect(logger.error).toHaveBeenCalledWith("worker.job_failed", expect.objectContaining({
      jobKind: "investigation",
      code: "STREAM_DESTINATION_BLOCKED",
      retryable: false,
    }));
  });
});
