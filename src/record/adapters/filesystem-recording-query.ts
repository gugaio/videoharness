import { JsonStore } from "../../store/json-file.js";
import type { RecordingEvent } from "../domain/recording-event.js";
import type { Recording } from "../domain/recording.js";
import type { RecordingQueryRepository } from "../ports/recording-query.js";
import { toRecording, type StoredRecording } from "./filesystem-recording-intake.js";

export class FilesystemRecordingQuery implements RecordingQueryRepository {
  constructor(private readonly store: JsonStore) {}

  async findById(id: string): Promise<Recording | null> {
    const row = await this.store.readJson<StoredRecording>("recordings", id, "recording.json");
    return row ? toRecording(row) : null;
  }

  async list(limit: number): Promise<Recording[]> {
    const directories = await this.store.listSubdirectories("recordings");
    const recordings: Recording[] = [];
    for (const id of directories) {
      const row = await this.store.readJson<StoredRecording>("recordings", id, "recording.json");
      if (row) recordings.push(toRecording(row));
    }
    return recordings.sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, limit);
  }

  async listEventsAfter(recordingId: string, afterEventId: string, limit: number): Promise<RecordingEvent[]> {
    const events = await this.store.readJsonl<RecordingEvent>("recordings", recordingId, "events.jsonl");
    return events
      .filter((event) => event.id > afterEventId)
      .sort((left, right) => left.id.localeCompare(right.id))
      .slice(0, limit);
  }
}