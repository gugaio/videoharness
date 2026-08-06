import type { RecordingEvent } from "../domain/recording-event.js";
import type { Recording } from "../domain/recording.js";
import type { RecordingQueryRepository } from "../ports/recording-query.js";

export type RecordingQueries = {
  getRecording(id: string): Promise<Recording | null>;
  listEventsAfter(recordingId: string, afterEventId: string): Promise<RecordingEvent[]>;
};

export function createRecordingQueries(repository: RecordingQueryRepository): RecordingQueries {
  return {
    getRecording: (id) => repository.findById(id),
    listEventsAfter: (id, after) => repository.listEventsAfter(id, after, 200),
  };
}
