import type { SpecialistAgentId } from "./types.js";

export type SpecialistProfile = {
  id: SpecialistAgentId;
  label: string;
  focus: string;
};

export const SPECIALIST_PROFILES: readonly SpecialistProfile[] = [
  { id: "timeline-playback", label: "Timeline & Playback", focus: "PTS/DTS continuity, A/V alignment, discontinuities and playback impact." },
  { id: "container-encoding", label: "Container & Encoding", focus: "Observed container boxes, codecs, initialization configuration, tracks, durations and keyframe evidence." },
  { id: "manifest-delivery", label: "Manifest & Delivery", focus: "Manifest topology, representation selection, delivery facts and declared versus observed media properties." },
] as const;

export const LEAD_AGENT_ID = "lead-investigator";
