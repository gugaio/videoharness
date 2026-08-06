import { Readable } from "node:stream";
import type { NetworkProfile, NetworkStage } from "../domain/playback-run.js";

type RunState = { videoRequests: number; tokens: number; lastRefillAt: number };

/** Process-local, shared bucket per run. Journal persistence is added in Slice 5. */
export class SharedNetworkShaper {
  private readonly runs = new Map<string, RunState>();
  constructor(private readonly now: () => number = Date.now, private readonly sleep: (milliseconds: number) => Promise<void> = delay) {}

  shape(input: { runId: string; profile: NetworkProfile; resourceKind: string; body: Uint8Array }): { stream: Readable; stage: NetworkStage; stageIndex: number } {
    const state = this.runs.get(input.runId) ?? { videoRequests: 0, tokens: 0, lastRefillAt: this.now() };
    this.runs.set(input.runId, state);
    const stageIndex = stageIndexFor(input.profile, state.videoRequests);
    const stage = input.profile.stages[stageIndex]!;
    if (input.resourceKind === "video-segment") state.videoRequests += 1;
    const paced = input.resourceKind !== "master" && input.resourceKind !== "media-playlist";
    return { stream: Readable.from(this.chunks(state, stage, input.body, paced)), stage, stageIndex };
  }

  private async *chunks(state: RunState, stage: NetworkStage, body: Uint8Array, paced: boolean): AsyncGenerator<Uint8Array> {
    if (stage.latencyMs > 0) await this.sleep(stage.latencyMs);
    for (let offset = 0; offset < body.byteLength; offset += 16_384) {
      const chunk = body.subarray(offset, Math.min(offset + 16_384, body.byteLength));
      if (paced) await this.take(state, stage.bandwidthKbps, chunk.byteLength);
      yield chunk;
    }
  }

  private async take(state: RunState, bandwidthKbps: number, bytes: number): Promise<void> {
    const bytesPerSecond = (bandwidthKbps * 1_000) / 8;
    const capacity = Math.max(16_384, bytesPerSecond);
    for (;;) {
      const now = this.now();
      state.tokens = Math.min(capacity, state.tokens + ((now - state.lastRefillAt) / 1_000) * bytesPerSecond);
      state.lastRefillAt = now;
      if (state.tokens >= bytes) { state.tokens -= bytes; return; }
      const missing = bytes - state.tokens;
      await this.sleep(Math.max(1, Math.ceil((missing / bytesPerSecond) * 1_000)));
    }
  }
}

export function stageFor(profile: NetworkProfile, videoRequestsBeforeCurrent: number): NetworkStage {
  return profile.stages[stageIndexFor(profile, videoRequestsBeforeCurrent)]!;
}
export function stageIndexFor(profile: NetworkProfile, videoRequestsBeforeCurrent: number): number { let selected = 0; for (let index = 1; index < profile.stages.length; index += 1) if (profile.stages[index]!.afterVideoRequests <= videoRequestsBeforeCurrent) selected = index; return selected; }

function delay(milliseconds: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
