export const recordedResourceKinds = ["master", "media-playlist", "init-segment", "video-segment", "audio-segment", "subtitle"] as const;
export type RecordedResourceKind = (typeof recordedResourceKinds)[number];

export type RecordedResource = {
  id: string;
  logicalPath: string;
  kind: RecordedResourceKind;
  storageKey: string;
  contentType?: string;
  sizeBytes: number;
  sha256: string;
  metadata: Record<string, unknown>;
};
