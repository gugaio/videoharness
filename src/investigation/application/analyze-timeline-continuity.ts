import type { MediaSample } from "../ports/media-sample-collector.js";

export type SegmentBoundaryGap = {
  fromLogicalKey: string;
  toLogicalKey: string;
  fromSequence?: number;
  toSequence?: number;
  presentationGapMs?: number;
  presentationOverlapMs?: number;
};

export type TimelineContinuityWindow = {
  key: string;
  kind: "video" | "audio" | "other";
  segmentCount: number;
  gaps: SegmentBoundaryGap[];
  totalGapMs: number;
  maxGapMs: number;
  continuous: boolean;
};

const GAP_THRESHOLD_MS = 50;

export function analyzeTimelineContinuity(samples: MediaSample[]): TimelineContinuityWindow[] {
  const mediaSamples = samples.filter((sample) => sample.kind === "media-segment");
  const byKey = new Map<string, MediaSample[]>();
  for (const sample of mediaSamples) {
    const key = sample.sourceManifestLogicalKey ?? "media";
    byKey.set(key, [...(byKey.get(key) ?? []), sample]);
  }
  const windows: TimelineContinuityWindow[] = [];
  for (const [key, grouped] of byKey) {
    const sorted = [...grouped].sort((left, right) =>
      (left.sampleIndex ?? left.sequence ?? 0) - (right.sampleIndex ?? right.sequence ?? 0));
    const gaps: SegmentBoundaryGap[] = [];
    let totalGapMs = 0;
    let maxGapMs = 0;
    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1]!;
      const next = sorted[index]!;
      if (!areContiguous(previous, next)) continue;
      const previousTrack = timedTrack(previous);
      const nextTrack = timedTrack(next);
      if (!previousTrack || !nextTrack || previousTrack.lastPts === undefined || nextTrack.firstPts === undefined) continue;
      const deltaMs = (nextTrack.firstPts - previousTrack.lastPts) * 1_000;
      if (deltaMs > GAP_THRESHOLD_MS) {
        const gapMs = Math.round(deltaMs);
        gaps.push({
          fromLogicalKey: previous.logicalKey,
          toLogicalKey: next.logicalKey,
          ...(previous.sequence === undefined ? {} : { fromSequence: previous.sequence }),
          ...(next.sequence === undefined ? {} : { toSequence: next.sequence }),
          presentationGapMs: gapMs,
        });
        totalGapMs += gapMs;
        maxGapMs = Math.max(maxGapMs, gapMs);
      } else if (deltaMs < -GAP_THRESHOLD_MS) {
        gaps.push({
          fromLogicalKey: previous.logicalKey,
          toLogicalKey: next.logicalKey,
          ...(previous.sequence === undefined ? {} : { fromSequence: previous.sequence }),
          ...(next.sequence === undefined ? {} : { toSequence: next.sequence }),
          presentationOverlapMs: Math.round(-deltaMs),
        });
      }
    }
    const representative = sorted[0];
    const kind = representative?.probe?.tracks.some((track) => track.kind === "video")
      ? "video"
      : representative?.probe?.tracks.some((track) => track.kind === "audio")
        ? "audio"
        : "other";
    windows.push({ key, kind, segmentCount: sorted.length, gaps, totalGapMs, maxGapMs, continuous: gaps.length === 0 });
  }
  return windows;
}

function areContiguous(previous: MediaSample, next: MediaSample): boolean {
  if (previous.sequence !== undefined && next.sequence !== undefined) return next.sequence === previous.sequence + 1;
  if (previous.sampleIndex !== undefined && next.sampleIndex !== undefined) return next.sampleIndex === previous.sampleIndex + 1;
  return false;
}

function timedTrack(sample: MediaSample): { lastPts?: number; firstPts?: number } | undefined {
  return sample.probe?.tracks.find((track) =>
    (track.kind === "video" || track.kind === "audio") && track.firstPts !== undefined && track.lastPts !== undefined);
}
