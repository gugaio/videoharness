export const recordingStates = ["queued", "validating", "collecting", "ready", "failed"] as const;

export type RecordingState = (typeof recordingStates)[number];

export type Recording = {
  id: string;
  sourceUrl: string;
  protocol: "hls" | "dash";
  state: RecordingState;
  requestedDurationSeconds: number;
  requestedStartSeconds: number;
  coverageSeconds?: number;
  totalBytes?: number;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};
