export type PlaybackRunState = "created" | "active" | "completed" | "expired" | "failed";

export type NetworkStage = { afterVideoRequests: number; bandwidthKbps: number; latencyMs: number };
export type NetworkProfile = { schemaVersion: 1; name: string; stages: NetworkStage[] };
export const baselineNetworkProfile: NetworkProfile = {
  schemaVersion: 1, name: "baseline", stages: [{ afterVideoRequests: 0, bandwidthKbps: 100_000, latencyMs: 0 }],
};

export type PlaybackRun = {
  id: string;
  recordingId: string;
  state: PlaybackRunState;
  maxDurationSeconds: number;
  profile: NetworkProfile;
  createdAt: string;
  expiresAt: string;
  firstMediaRequestAt?: string;
  completedAt?: string;
  errorCode?: string;
  errorMessage?: string;
};
