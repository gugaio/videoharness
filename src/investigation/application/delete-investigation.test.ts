import { describe, expect, it, vi } from "vitest";
import type { InvestigationDeletionRepository } from "../ports/investigation-deletion.js";
import type { ArtifactStore } from "../ports/artifact-store.js";
import { createDeleteInvestigation } from "./delete-investigation.js";

const investigationId = "c56a4180-65aa-42ec-a945-5fd21dec0538";
const investigation = {
  id: investigationId,
  sourceUrl: "https://example.test/live/master.m3u8",
  state: "completed" as const,
  createdAt: "2026-08-14T12:00:00.000Z",
  updatedAt: "2026-08-14T12:00:00.000Z",
};

function createInput(overrides: Partial<Parameters<typeof createDeleteInvestigation>[0]> = {}) {
  return {
    queries: {
      getInvestigation: vi.fn(async () => investigation),
      listArtifacts: vi.fn(async () => [{
        id: "8dc67e09-4b25-4fe5-a69a-58f896fb5197",
        logicalKey: "manifest/root",
        kind: "manifest" as const,
        storageKey: "artifacts/case/manifest.m3u8",
        createdAt: "2026-08-14T12:00:00.000Z",
      }]),
    },
    repository: {
      delete: vi.fn(async () => ({ deleted: true, recordingIds: ["recording-1"] })),
    } as unknown as InvestigationDeletionRepository,
    artifactStore: {
      remove: vi.fn(async () => undefined),
    } as unknown as ArtifactStore,
    removeInvestigationFiles: vi.fn(async () => undefined),
    removeRecordingFiles: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("delete investigation", () => {
  it("returns not deleted when the investigation does not exist", async () => {
    const input = createInput({
      queries: {
        getInvestigation: vi.fn(async () => null),
        listArtifacts: vi.fn(async () => []),
      },
    });
    const del = createDeleteInvestigation(input);

    await expect(del(investigationId)).resolves.toEqual({ deleted: false });
    expect(input.repository.delete).not.toHaveBeenCalled();
  });

  it("deletes the database row and removes artifacts, files and linked recordings", async () => {
    const input = createInput();
    const del = createDeleteInvestigation(input);

    await expect(del(investigationId)).resolves.toEqual({ deleted: true });

    expect(input.repository.delete).toHaveBeenCalledWith(investigationId);
    expect(input.artifactStore.remove).toHaveBeenCalledWith("artifacts/case/manifest.m3u8");
    expect(input.removeInvestigationFiles).toHaveBeenCalledWith(investigationId);
    expect(input.removeRecordingFiles).toHaveBeenCalledWith("recording-1");
  });

  it("keeps the deletion confirmed when a filesystem cleanup fails", async () => {
    const input = createInput({
      removeRecordingFiles: vi.fn(async () => { throw new Error("disk unavailable"); }),
    });
    const del = createDeleteInvestigation(input);

    await expect(del(investigationId)).resolves.toEqual({ deleted: true });
    expect(input.repository.delete).toHaveBeenCalledWith(investigationId);
  });

  it("skips artifact removal when the investigation is not found", async () => {
    const input = createInput({
      queries: {
        getInvestigation: vi.fn(async () => null),
        listArtifacts: vi.fn(async () => []),
      },
    });
    const del = createDeleteInvestigation(input);

    await expect(del(investigationId)).resolves.toEqual({ deleted: false });
    expect(input.artifactStore.remove).not.toHaveBeenCalled();
  });
});
