import type { ClaimedRecordingJob } from "../domain/recording-job.js";
import type { MaterializedRecording } from "./recording-materializer.js";

/** Optional lifecycle hook used by features layered on top of Record. */
export interface RecordingObserver {
  started(input: { job: ClaimedRecordingJob }): Promise<void>;
  completed(input: { job: ClaimedRecordingJob; result: MaterializedRecording }): Promise<void>;
  failed(input: { job: ClaimedRecordingJob; errorCode: string; errorMessage: string }): Promise<void>;
}
