export type RecordingEvent = {
  id: string;
  recordingId: string;
  type: string;
  actor: string;
  message: string;
  payload: Record<string, unknown>;
  createdAt: string;
};
