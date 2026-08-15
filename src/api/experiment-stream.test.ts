import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FilesystemRecordingStore } from "../record/adapters/filesystem-recording-store.js";
import { buildApiServer } from "./server.js";

const experimentId = "c56a4180-65aa-42ec-a945-5fd21dec0538";
const controlRecordingId = "8dc67e09-4b25-4fe5-a69a-58f896fb5197";
const treatmentRecordingId = "7d9d633e-3118-42e9-a4bb-2d917bbe3290";

describe("stable experiment playback URL", () => {
  const directories: string[] = [];
  afterEach(async () => Promise.all(directories.splice(0).map((entry) => fs.rm(entry, { recursive: true, force: true }))));

  it("serves different selected treatments without changing the device URL", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "video-harness-experiment-stream-"));
    directories.push(directory);
    const store = new FilesystemRecordingStore(directory);
    await publish(store, controlRecordingId, "#EXTM3U\n# CONTROL\n");
    await publish(store, treatmentRecordingId, "#EXTM3U\n# LOW-BR\n");
    let selected = controlRecordingId;
    const server = buildApiServer({
      database: { check: async () => undefined },
      startInvestigation: async () => ({ created: true, investigation: { id: experimentId, sourceUrl: "https://example.test/master.m3u8", state: "queued", createdAt: "2026-08-11T00:00:00.000Z", updatedAt: "2026-08-11T00:00:00.000Z" } }),
      investigationQueries: { getInvestigation: async () => null, getReport: async () => null, listEventsAfter: async () => [], listInvestigations: async () => [] },
      playbackRuns: { create: async () => "recording_not_ready", findById: async () => null, findLatestOpen: async () => null, finish: async () => null, recordDelivery: async () => undefined, listDeliveries: async () => [] },
      recordingStore: store,
      experimentStreams: { resolveActiveStream: async (id) => id === experimentId ? { experimentId, testRequestId: "b27d184e-b47a-4a5c-b8a6-b42152083ea9", cloneId: "4a30ea1e-1272-4f48-bbf0-7f24b84521ea", recordingId: selected, protocol: "hls" } : null },
    });
    const url = `/streams/experiments/${experimentId}/index.m3u8`;
    expect((await server.inject({ method: "GET", url })).body).toContain("CONTROL");
    selected = treatmentRecordingId;
    expect((await server.inject({ method: "GET", url })).body).toContain("LOW-BR");
    expect((await server.inject({ method: "GET", url })).headers["cache-control"]).toBe("no-store");
    await server.close();
  });
});

async function publish(store: FilesystemRecordingStore, recordingId: string, content: string): Promise<void> {
  const workspace = await store.prepareWorkspace(recordingId);
  await fs.writeFile(path.join(workspace.path, "index.m3u8"), content);
  await store.publish(workspace);
}
