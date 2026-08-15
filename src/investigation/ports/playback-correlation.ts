import type { AbrSwitchEvidence } from "../../abr/domain/evidence.js";

/** Observed quality transitions from related Record playback runs, linked via experiments. */
export interface PlaybackCorrelationProvider {
  listObservedSwitches(investigationId: string): Promise<AbrSwitchEvidence[]>;
}
