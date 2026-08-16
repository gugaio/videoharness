import type { RecordingEvent } from "../domain/recording-event.js";
import type { Recording } from "../domain/recording.js";

export interface RecordingQueryRepository {
  findById(id: string): Promise<Recording | null>;
  list(limit: number): Promise<Recording[]>;
  listEventsAfter(recordingId: string, afterEventId: string, limit: number): Promise<RecordingEvent[]>;
}
