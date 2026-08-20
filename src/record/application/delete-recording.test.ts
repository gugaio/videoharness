import { describe, expect, it, vi } from "vitest";
import { createDeleteRecording } from "./delete-recording.js";
import type { RecordingDeletionRepository } from "./recording-deletion-repository.js";
import type { FilesystemRecordingStore } from "../adapters/filesystem-recording-store.js";

describe("deleteRecording", () => {
  it("removes published and temporary files before deleting the database row", async () => {
    const calls: string[] = [];
    const repository = { canDelete: vi.fn(async () => "ready"), delete: vi.fn(async () => { calls.push("database"); return "deleted" as const; }) } as unknown as RecordingDeletionRepository;
    const store = { removePublished: vi.fn(async () => { calls.push("published"); }), discardWorkspace: vi.fn(async () => { calls.push("workspace"); }) } as unknown as FilesystemRecordingStore;
    await expect(createDeleteRecording(repository, store)("c56a4180-65aa-42ec-a945-5fd21dec0538")).resolves.toBe("deleted");
    expect(calls).toContain("published");
    expect(calls).toContain("workspace");
    expect(calls.indexOf("database")).toBeGreaterThan(calls.indexOf("published"));
    expect(calls.indexOf("database")).toBeGreaterThan(calls.indexOf("workspace"));
  });

  it("does not touch storage for an experiment recording", async () => {
    const repository = { canDelete: vi.fn(async () => "linked_to_experiment"), delete: vi.fn() } as unknown as RecordingDeletionRepository;
    const store = { removePublished: vi.fn(), discardWorkspace: vi.fn() } as unknown as FilesystemRecordingStore;
    await expect(createDeleteRecording(repository, store)("c56a4180-65aa-42ec-a945-5fd21dec0538")).resolves.toBe("linked_to_experiment");
    expect(store.removePublished).not.toHaveBeenCalled();
  });
});
