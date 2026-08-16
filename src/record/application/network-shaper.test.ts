import { describe, expect, it } from "vitest";
import { SharedNetworkShaper, stageFor } from "./network-shaper.js";
import type { NetworkProfile } from "../domain/playback-run.js";

const profile: NetworkProfile = {
  schemaVersion: 1, name: "downshift", stages: [
    { afterVideoRequests: 0, bandwidthKbps: 100_000, latencyMs: 0 },
    { afterVideoRequests: 3, bandwidthKbps: 1_200, latencyMs: 200 },
  ],
};

describe("SharedNetworkShaper", () => {
  it("selects stages from the number of prior video requests", () => {
    expect(stageFor(profile, 0)).toEqual(profile.stages[0]);
    expect(stageFor(profile, 2)).toEqual(profile.stages[0]);
    expect(stageFor(profile, 3)).toEqual(profile.stages[1]);
  });

  it("streams the complete response in chunks", async () => {
    const shaper = new SharedNetworkShaper();
    const body = new TextEncoder().encode("a".repeat(20_000));
    const chunks: Uint8Array[] = [];
    for await (const chunk of shaper.shape({ runId: "run-1", profile, resourceKind: "video-segment", body }).stream) {
      chunks.push(chunk as Uint8Array);
    }
    expect(chunks).toHaveLength(2);
    expect(Buffer.concat(chunks).byteLength).toBe(20_000);
  });

  it("adds a deterministic fault delay to the configured network latency", async () => {
    const waits: number[] = [];
    const shaper = new SharedNetworkShaper(() => 0, async (milliseconds) => { waits.push(milliseconds); });
    for await (const _chunk of shaper.shape({ runId: "run-delay", profile, resourceKind: "master", body: new Uint8Array([1]), additionalLatencyMs: 250 }).stream) { /* consume */ }
    expect(waits).toContain(250);
  });
});
