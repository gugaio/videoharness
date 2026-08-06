import type { PlaybackRunRepository } from "../ports/playback-run.js";
import type { NetworkProfile } from "../domain/playback-run.js";

export type CreatePlaybackRun = (input: { recordingId: string; maxDurationSeconds: number; profile: NetworkProfile }) => ReturnType<PlaybackRunRepository["create"]>;

export function createPlaybackRun(repository: PlaybackRunRepository): CreatePlaybackRun {
  return ({ recordingId, maxDurationSeconds, profile }) => repository.create(recordingId, maxDurationSeconds, profile);
}
