export type PlaybackRunState = "created" | "active" | "completed" | "expired" | "failed";

export type NetworkStage = { afterVideoRequests: number; bandwidthKbps: number; latencyMs: number };
export type NetworkProfile = { schemaVersion: 1; name: string; stages: NetworkStage[] };
export type FaultSelector = {
  resourceKind: "master" | "media-playlist" | "init-segment" | "video-segment" | "audio-segment";
  targetId?: string | undefined;
  mediaSequence?: number | undefined;
};
export type FaultAction =
  | { type: "delay"; delayMs: number }
  | { type: "status"; statusCode: number }
  | { type: "truncate_body"; keepBytes: number };
export type FaultRule = { id: string; when: FaultSelector; everyNthMatch?: number | undefined; action: FaultAction };
export type FaultPlan = { schemaVersion: 1; name: string; rules: FaultRule[] };
export const baselineNetworkProfile: NetworkProfile = {
  schemaVersion: 1, name: "baseline", stages: [{ afterVideoRequests: 0, bandwidthKbps: 100_000, latencyMs: 0 }],
};

export type PlaybackRun = {
  id: string;
  recordingId: string;
  state: PlaybackRunState;
  maxDurationSeconds: number;
  profile: NetworkProfile;
  faultPlan?: FaultPlan;
  createdAt: string;
  expiresAt: string;
  firstMediaRequestAt?: string;
  completedAt?: string;
  errorCode?: string;
  errorMessage?: string;
};
