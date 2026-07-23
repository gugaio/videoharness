import type { ManifestCollection } from "./manifest-collector.js";

export type MediaSample = {
  logicalKey: string;
  kind: "init-segment" | "media-segment";
  sourceManifestLogicalKey: string;
  sampleIndex?: number;
  sequence?: number;
  declaredDuration?: number;
  content: { bytes: Uint8Array };
  artifact?: { id: string; storageKey: string; sizeBytes: number };
  probe?: MediaProbeResult;
};

export type MediaProbeTrack = {
  kind: "video" | "audio" | "other";
  codec?: string;
  duration?: number;
  firstPts?: number;
  lastPts?: number;
  width?: number;
  height?: number;
  frameRate?: string;
  sampleRate?: number;
  channels?: number;
};

export type MediaProbeResult = {
  format?: string;
  duration?: number;
  tracks: MediaProbeTrack[];
};

export interface MediaSampleCollector {
  collect(collection: ManifestCollection): Promise<{ samples: MediaSample[]; limitations: string[] }>;
}

export interface MediaProbe {
  probe(input: { investigationId: string; sample: MediaSample; initBytes?: Uint8Array }): Promise<MediaProbeResult>;
}
