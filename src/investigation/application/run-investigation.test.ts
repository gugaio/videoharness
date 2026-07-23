import { afterEach, describe, expect, it, vi } from "vitest";
import { StreamCollectionError } from "../../stream-tools/errors.js";
import type { InvestigationJobRepository } from "../ports/investigation-job.js";
import type { InvestigationAI } from "../ports/investigation-ai.js";
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
    recordEvidenceBatch: vi.fn(async () => ({ supersededStorageKeys: [] })),
    complete: vi.fn(async () => undefined),
    fail: vi.fn(async () => "retrying" as const),
  };
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
    expect(repository.recordEvidenceBatch).toHaveBeenCalledOnce();
    expect(repository.recordEvidenceBatch).toHaveBeenCalledWith(
      claimedJob.id,
      "worker-test",
      30_000,
      [expect.objectContaining({ logicalKey: "manifest/root", kind: "manifest" })],
      expect.objectContaining({ schemaVersion: 2, manifests: expect.any(Array), mediaSamples: [] }),
      expect.objectContaining({ type: "investigation.evidence_found" }),
    );
    expect(repository.complete).toHaveBeenCalledWith(
      claimedJob.id,
      "worker-test",
      expect.any(String),
      expect.objectContaining({ placeholder: false, generatedBy: "deterministic-media-v1" }),
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
      supersededStorageKeys: ["artifacts/case/previous.m3u8"],
    });
    const worker = createInvestigationWorker({
      repository, collector, artifactStore, workerId: "worker-test", leaseMs: 30_000,
    });

    await expect(worker.runNext()).resolves.toBe(true);

    expect(artifactStore.remove).toHaveBeenCalledWith("artifacts/case/previous.m3u8");
    expect(artifactStore.remove).not.toHaveBeenCalledWith("artifacts/case/manifest.m3u8");
    expect(repository.complete).toHaveBeenCalledOnce();
  });

  it("publishes real per-agent progress events while the AI analysis runs", async () => {
    const repository = createRepository();
    const ai: InvestigationAI = {
      investigate: async (input) => {
        await input.onProgress?.({ agent: "timeline-playback", stage: "started", completed: 0, total: 4 });
        await input.onProgress?.({ agent: "timeline-playback", stage: "completed", completed: 1, total: 4 });
        await input.onProgress?.({
          agent: "container-encoding",
          stage: "failed",
          completed: 2,
          total: 4,
          limitation: "The AI analysis timed out after retry.",
        });
        return {
          available: true,
          findings: [],
          recommendations: [],
          limitations: [],
          agents: [
            { id: "timeline-playback", state: "completed" },
            { id: "container-encoding", state: "failed" },
            { id: "manifest-delivery", state: "completed" },
            { id: "lead-investigator", state: "completed" },
          ],
        };
      },
    };
    const worker = createInvestigationWorker({
      repository, collector, artifactStore, ai, workerId: "worker-test", leaseMs: 30_000,
    });

    await expect(worker.runNext()).resolves.toBe(true);

    const events = vi.mocked(repository.transition).mock.calls.map((call) => call[3].event);
    const progressEvents = events.filter((event) => event.payload.stage === "ai_agent");
    expect(progressEvents).toEqual([
      {
        type: "investigation.observation",
        actor: "timeline-playback",
        message: "Timeline & Playback analysis started.",
        payload: { state: "analyzing", stage: "ai_agent", agent: "timeline-playback", agentStage: "started", completed: 0, total: 4 },
      },
      {
        type: "investigation.observation",
        actor: "timeline-playback",
        message: "Timeline & Playback analysis complete.",
        payload: { state: "analyzing", stage: "ai_agent", agent: "timeline-playback", agentStage: "completed", completed: 1, total: 4 },
      },
      {
        type: "investigation.observation",
        actor: "container-encoding",
        message: "Container & Encoding analysis could not complete: The AI analysis timed out after retry.",
        payload: { state: "analyzing", stage: "ai_agent", agent: "container-encoding", agentStage: "failed", completed: 2, total: 4 },
      },
    ]);
    const aiSpecialistsIndex = events.findIndex((event) => event.payload.stage === "ai_specialists");
    const aiCompleteIndex = events.findIndex((event) => event.payload.stage === "ai_complete");
    expect(aiSpecialistsIndex).toBeGreaterThan(-1);
    expect(aiCompleteIndex).toBeGreaterThan(aiSpecialistsIndex + progressEvents.length);
    expect(repository.complete).toHaveBeenCalledOnce();
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
