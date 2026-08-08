import type { PlaybackRun } from "../domain/playback-run.js";
import type { NetworkProfile } from "../domain/playback-run.js";

export type CreatedPlaybackRun = { run: PlaybackRun; playbackToken: string; manifestPath: "index.m3u8" | "index.mpd" };
export type ResolvedPlaybackResource = {
  runId: string;
  state: PlaybackRun["state"];
  storageKey: string;
  contentType?: string;
  sizeBytes: number;
  resourceKind: string;
  profile: NetworkProfile;
  metadata: Record<string, unknown>;
};
export type DeliveryRequest = { id: string; logicalPath: string; resourceKind: string; targetId?: string; mediaSequence?: number; variantBandwidth?: number; variantResolution?: string; stageIndex: number; bandwidthKbps: number; latencyMs: number; bytesSent: number; statusCode: number; startedAt: string; completedAt: string };

export interface PlaybackRunRepository {
  create(recordingId: string, maxDurationSeconds: number, profile: NetworkProfile): Promise<CreatedPlaybackRun | "recording_not_ready">;
  findById(recordingId: string, runId: string): Promise<PlaybackRun | null>;
  resolveResource(tokenHash: string, logicalPath: string): Promise<ResolvedPlaybackResource | "expired" | null>;
  resolveFixedResource(logicalPath: string): Promise<ResolvedPlaybackResource | "expired" | null>;
  recordDelivery(input: Omit<DeliveryRequest, "id" | "completedAt"> & { runId: string }): Promise<void>;
  listDeliveries(recordingId: string, runId: string, limit: number): Promise<DeliveryRequest[]>;
}
