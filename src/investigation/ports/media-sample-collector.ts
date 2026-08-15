import type { CollectionProgress, ManifestCollection } from "./manifest-collector.js";
import type { Fmp4InitInspection, HevcAccessUnitInspection } from "../../stream-tools/isobmff.js";
import type { HttpRequestFacts } from "../../stream-tools/safe-http-client.js";

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
    http?: HttpRequestFacts;
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
  codecTagString?: string;
  profile?: string;
  level?: number;
  codedWidth?: number;
  codedHeight?: number;
  pixelFormat?: string;
  refs?: number;
  timeBase?: string;
  averageFrameRate?: string;
  colorRange?: string;
  colorSpace?: string;
  colorTransfer?: string;
  colorPrimaries?: string;
  chromaLocation?: string;
};

export type FfprobeFrameSummary = {
  keyFrame?: boolean;
  pictureType?: string;
  pts?: string;
  ptsTime?: number;
  packetDts?: string;
  packetDtsTime?: number;
  bestEffortTimestamp?: string;
  duration?: string;
  width?: number;
  height?: number;
  pixelFormat?: string;
  colorRange?: string;
  colorSpace?: string;
  colorTransfer?: string;
  colorPrimaries?: string;
  sideDataTypes: string[];
};

export type FfprobeGopSummary = {
  index: number;
  startFrameIndex: number;
  frameCount: number;
  startsWithKeyFrame: boolean;
  firstPtsTime?: number;
  lastPtsTime?: number;
  frames: FfprobeFrameSummary[];
  truncated: boolean;
};

export type FfprobeBoundarySummary = {
  packets: Array<{ pts?: string; ptsTime?: number; dts?: string; dtsTime?: number; duration?: string; durationTime?: number; size?: number; pos?: string; flags?: string }>;
  frames: FfprobeFrameSummary[];
  gops: FfprobeGopSummary[];
  totalGopCount: number;
  totalPacketCount: number;
  totalFrameCount: number;
};

export type MediaProbeResult = {
  format?: string;
  duration?: number;
  tracks: MediaProbeTrack[];
  structural?: import("../../stream-tools/ts-sanity.js").TsSanity;
  boundary?: FfprobeBoundarySummary;
  fmp4?: {
    init?: Fmp4InitInspection;
    fragment: {
      styp?: import("../../stream-tools/isobmff.js").Fmp4FragmentInspection["styp"];
      sidx?: import("../../stream-tools/isobmff.js").Fmp4FragmentInspection["sidx"];
      sequenceNumber?: number;
      baseMediaDecodeTime?: string;
      trafs: import("../../stream-tools/isobmff.js").Fmp4TrafInspection[];
      samples: Array<{ dts: string; pts: string; duration?: string; size?: number; flags?: number; sync?: boolean; compositionOffset?: string; nalTypes: number[]; accessUnit: HevcAccessUnitInspection; firstFrameKind: "idr" | "cra" | "bla" | "rasl" | "radl" | "other" | "unknown" }>;
      drmBoxTypes: string[];
      structuralErrors: string[];
    };
  };
};

export interface MediaSampleCollector {
  collect(collection: ManifestCollection, onProgress?: (progress: CollectionProgress) => Promise<void>): Promise<{ samples: MediaSample[]; limitations: string[] }>;
}

export interface MediaProbe {
  probe(input: { investigationId: string; sample: MediaSample; initBytes?: Uint8Array }): Promise<MediaProbeResult>;
}
