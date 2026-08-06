import type { ManifestCollection } from "./manifest-collector.js";

export type MediaSample = {
  logicalKey: string;
  kind: "init-segment" | "media-segment";
  sourceManifestLogicalKey: string;
  sampleIndex?: number;
  sequence?: number;
  declaredDuration?: number;
  representationId?: string;
  periodIndex?: number;
  adaptationSetIndex?: number;
  presentationStartSeconds?: number;
  presentationEndSeconds?: number;
  source?: {
    url: string;
    sha256: string;
    observedHashes?: string[];
    httpStatus: number;
    contentLength?: number;
  };
  content: { bytes: Uint8Array };
  artifact?: { id: string; storageKey: string; sizeBytes: number; sha256?: string };
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
  fmp4?: {
    init?: {
      fourcc?: string;
      timescale?: number;
      nalLengthSize?: number;
      hevc?: { profileIdc: number; levelIdc: number; tierFlag: boolean; chromaFormat: number; bitDepthLuma: number; bitDepthChroma: number; parameterSetHashes: Partial<Record<"vps" | "sps" | "pps", string[]>> };
      structuralErrors: string[];
    };
    fragment: {
      sequenceNumber?: number;
      baseMediaDecodeTime?: string;
      samples: Array<{ dts: string; pts: string; duration?: string; size?: number; flags?: number; sync?: boolean; compositionOffset?: string; firstFrameKind: "idr" | "cra" | "bla" | "rasl" | "radl" | "other" | "unknown" }>;
      structuralErrors: string[];
    };
  };
};

export interface MediaSampleCollector {
  collect(collection: ManifestCollection): Promise<{ samples: MediaSample[]; limitations: string[] }>;
}

export interface MediaProbe {
  probe(input: { investigationId: string; sample: MediaSample; initBytes?: Uint8Array }): Promise<MediaProbeResult>;
}
