import type { RecordingMaterializer } from "../ports/recording-materializer.js";

/** Selects a protocol-specific collector after the durable intake has classified the source. */
export class ProtocolRecordingMaterializer implements RecordingMaterializer {
  constructor(private readonly hls: RecordingMaterializer, private readonly dash: RecordingMaterializer) {}

  materialize(input: Parameters<RecordingMaterializer["materialize"]>[0]) {
    return input.job.recording.protocol === "dash" ? this.dash.materialize(input) : this.hls.materialize(input);
  }
}
