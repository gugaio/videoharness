import type { PlaybackRun } from "../domain/playback-run.js";
import type { NetworkProfile } from "../domain/playback-run.js";

export type CreatedPlaybackRun = { run: PlaybackRun; manifestPath: "index.m3u8" | "index.mpd" };
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
export type RecordedDiagnosticResource = { logicalPath: string; resourceKind: string; sizeBytes: number; sha256: string; metadata: Record<string, unknown> };

export interface PlaybackRunRepository {
  create(recordingId: string, maxDurationSeconds: number, profile: NetworkProfile): Promise<CreatedPlaybackRun | "recording_not_ready">;
  findById(recordingId: string, runId: string): Promise<PlaybackRun | null>;
  findLatestOpen(recordingId: string): Promise<PlaybackRun | null>;
  finish(recordingId: string, runId: string): Promise<PlaybackRun | null>;
  recordDelivery(input: Omit<DeliveryRequest, "id" | "completedAt"> & { runId: string }): Promise<void>;
  listDeliveries(recordingId: string, runId: string, limit: number): Promise<DeliveryRequest[]>;
  listDiagnosticResources?(recordingId: string): Promise<RecordedDiagnosticResource[]>;
}
