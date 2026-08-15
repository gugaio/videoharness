export const cloneModes = ["manifest_only", "remux", "repackage", "transcode", "hybrid"] as const;
export type CloneMode = (typeof cloneModes)[number];

export type CloneSpec = {
  version: "1";
  source: {
    investigationId: string;
    mode: "recorded_snapshot" | "live_proxy";
    snapshotDurationSeconds?: number;
  };
  mode: CloneMode;
  video?: {
    codec?: string;
    profile?: string;
    level?: string;
    pixelFormat?: string;
    width?: number;
    height?: number;
    frameRate?: number;
    bitrate?: number;
    maxBitrate?: number | null;
    bufferSize?: number | null;
    gopSeconds?: number;
    closedGop?: boolean;
    hdrMode?: string | null;
  };
  audio?: {
    codec?: string;
    channels?: number;
    channelLayout?: string;
    sampleRate?: number;
    bitrate?: number;
    language?: string | null;
  };
  packaging?: {
    protocol: "hls" | "dash";
    container?: "mpegts" | "fmp4" | "cmaf";
    segmentDurationSeconds?: number;
  };
  abr?: {
    mode: "preserve" | "single_representation" | "subset" | "custom";
    representationIds?: string[];
    targetBitrate?: number | null;
  };
  manifest?: {
    normalisation: "preserve" | "minimal" | "custom";
    operations?: Array<{
      op: "filter_representations" | "single_audio" | "remove_subtitles" | "sort_by_bandwidth";
      representationIds?: string[];
    }>;
  };
  reason: {
    role: "control" | "treatment";
    shortLabel: string;
    hypothesisIds: string[];
    description: string;
    expectedDiscriminatingSignal: string;
  };
};

export type CloneSourceEvidence = {
  investigationId: string;
  protocol: "hls" | "dash";
  live: boolean;
  artifactIds: string[];
  representations: Array<{
    id: string;
    bandwidth?: number;
    width?: number;
    height?: number;
    frameRate?: number;
    codecs?: string;
  }>;
  audioRenditionCount: number;
};

export type CloneExecutionPlan = {
  version: "1";
  specVersion: "1";
  protocol: "hls" | "dash";
  sourceMode: "recorded_snapshot" | "live_proxy";
  transformations: Array<{
    kind: "record_snapshot" | "filter_video_representations" | "single_audio" | "minimal_manifest";
    description: string;
    representationIds?: string[];
  }>;
  selection: {
    videoRepresentationIds: string[];
    audioMode: "preserve" | "single";
    expectedAudioRenditionCount: number;
  };
  processes: Array<{
    binary: "ffmpeg" | "ffprobe" | "shaka-packager";
    args: string[];
  }>;
  whatChanged: string;
  expectedDiscriminatingSignal: string;
  sourceArtifactIds: string[];
};

export type CloneVerificationReport = {
  verifiedAt: string;
  status: "PASSED" | "FAILED";
  manifest: {
    protocol?: "hls" | "dash";
    kind?: "master" | "media" | "mpd";
    videoRepresentationCount?: number;
    audioRepresentationCount?: number;
  };
  requested: {
    videoRepresentationIds: string[];
    audioMode: "preserve" | "single";
  };
  outputArtifactIds: string[];
  warnings: string[];
  errors: string[];
};

export const cloneRecipeNames = [
  "control",
  "force_representation",
  "hls_mpegts",
  "hls_fmp4",
  "minimal_hls",
  "aac_stereo",
  "single_audio",
  "single_video_representation",
  "representation_subset",
  "fixed_bitrate",
  "fixed_resolution",
  "fixed_frame_rate",
  "short_gop",
  "dash_demuxed",
] as const;

export type CloneRecipeName = (typeof cloneRecipeNames)[number];
