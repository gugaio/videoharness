import type { CreatedPlaybackRun, PlaybackRunRepository } from "../ports/playback-run.js";
import type { NetworkProfile } from "../domain/playback-run.js";

export type CreatePlaybackRun = (input: { recordingId: string; maxDurationSeconds: number; profile: NetworkProfile }) => Promise<CreatedPlaybackRun | "recording_not_ready">;

export function createPlaybackRun(repository: PlaybackRunRepository): CreatePlaybackRun {
  return async ({ recordingId, maxDurationSeconds, profile }) => repository.create(recordingId, maxDurationSeconds, profile);
}
