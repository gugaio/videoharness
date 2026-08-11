import type { TimelineEvidence } from "../domain/evidence.js";

export type TimelineSample = { dts: string | bigint | number; pts: string | bigint | number; duration?: string | bigint | number };
export type TimelineTrackBoundary = {
  timescale: number;
  presentationTimeOffset?: string | bigint | number;
  periodStartSeconds?: number;
  editListOffsetSeconds?: number;
  samples: TimelineSample[];
};

export type TimelineBoundaryInput = {
  evidenceId: string;
  sourceVideo: TimelineTrackBoundary;
  targetVideo: TimelineTrackBoundary;
  sourceAudio?: TimelineTrackBoundary;
  targetAudio?: TimelineTrackBoundary;
  toleranceMs?: number;
};

/** Converts representation-local decode/presentation clocks to one Period timeline. */
export class TimelineNormalizer {
  normalize(input: TimelineBoundaryInput): TimelineEvidence {
    const toleranceMs = input.toleranceMs ?? 2;
    const sourceVideoLast = input.sourceVideo.samples.at(-1);
    const targetVideoFirst = input.targetVideo.samples[0];
    const sourceVideoStart = input.sourceVideo.samples[0];
    const targetVideoLast = input.targetVideo.samples.at(-1);
    const expectedDecode = sourceVideoLast ? normalize(input.sourceVideo, add(sourceVideoLast.dts, sourceVideoLast.duration)) : undefined;
    const targetDecode = targetVideoFirst ? normalize(input.targetVideo, targetVideoFirst.dts) : undefined;
    const expectedPresentation = sourceVideoLast ? normalize(input.sourceVideo, add(sourceVideoLast.pts, sourceVideoLast.duration)) : undefined;
    const targetPresentation = targetVideoFirst ? normalize(input.targetVideo, targetVideoFirst.pts) : undefined;
    const decodeDelta = deltaMs(expectedDecode, targetDecode);
    const presentationDelta = deltaMs(expectedPresentation, targetPresentation);

    const sourceAudioLast = input.sourceAudio?.samples.at(-1);
    const targetAudioFirst = input.targetAudio?.samples[0];
    const expectedAudio = sourceAudioLast && input.sourceAudio ? normalize(input.sourceAudio, add(sourceAudioLast.pts, sourceAudioLast.duration)) : undefined;
    const targetAudio = targetAudioFirst && input.targetAudio ? normalize(input.targetAudio, targetAudioFirst.pts) : undefined;
    const audioDelta = deltaMs(expectedAudio, targetAudio);
    const avSkewBefore = deltaMs(expectedPresentation, expectedAudio);
    const avSkewAfter = deltaMs(targetPresentation, targetAudio);

    return {
      evidenceId: input.evidenceId,
      toleranceMs,
      ...(expectedDecode === undefined ? {} : { expectedNextVideoDecodeTime: expectedDecode }),
      ...(targetDecode === undefined ? {} : { actualTargetVideoDecodeTime: targetDecode }),
      ...gapAndOverlap("videoDecode", decodeDelta, toleranceMs),
      ...(expectedPresentation === undefined ? {} : { expectedNextVideoPresentationTime: expectedPresentation }),
      ...(targetPresentation === undefined ? {} : { actualTargetVideoPresentationTime: targetPresentation }),
      ...gapAndOverlap("videoPresentation", presentationDelta, toleranceMs),
      ...gapAndOverlap("audio", audioDelta, toleranceMs),
      ...(avSkewBefore === undefined ? {} : { avSkewBeforeMs: avSkewBefore }),
      ...(avSkewAfter === undefined ? {} : { avSkewAfterMs: avSkewAfter }),
      ...(avSkewBefore === undefined || avSkewAfter === undefined ? {} : { avSkewDeltaMs: avSkewAfter - avSkewBefore }),
      ...(sourceVideoStart && sourceVideoLast ? { sourceSegmentDurationMs: durationMs(input.sourceVideo, sourceVideoStart, sourceVideoLast) } : {}),
      ...(targetVideoFirst && targetVideoLast ? { targetSegmentDurationMs: durationMs(input.targetVideo, targetVideoFirst, targetVideoLast) } : {}),
    };
  }
}

function normalize(track: TimelineTrackBoundary, raw: string | bigint | number): number {
  if (!Number.isFinite(track.timescale) || track.timescale <= 0) throw new Error("Timeline timescale must be positive");
  const ticks = numeric(raw) - numeric(track.presentationTimeOffset ?? 0);
  return (track.periodStartSeconds ?? 0) + ticks / track.timescale + (track.editListOffsetSeconds ?? 0);
}

function add(value: string | bigint | number, duration: string | bigint | number | undefined): bigint {
  return integer(value) + integer(duration ?? 0);
}

function numeric(value: string | bigint | number): number {
  const converted = Number(value);
  if (!Number.isFinite(converted)) throw new Error("Timeline value is not finite");
  return converted;
}

function integer(value: string | bigint | number): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.trunc(value));
  return BigInt(value);
}

function deltaMs(expected: number | undefined, actual: number | undefined): number | undefined {
  return expected === undefined || actual === undefined ? undefined : (actual - expected) * 1_000;
}

function gapAndOverlap(prefix: "videoDecode" | "videoPresentation" | "audio", delta: number | undefined, toleranceMs: number): Partial<TimelineEvidence> {
  if (delta === undefined) return {};
  const value = Math.abs(delta) <= toleranceMs ? 0 : delta;
  if (prefix === "videoDecode") return { videoDecodeGapMs: Math.max(0, value), videoDecodeOverlapMs: Math.max(0, -value) };
  if (prefix === "videoPresentation") return { videoPresentationGapMs: Math.max(0, value), videoPresentationOverlapMs: Math.max(0, -value) };
  return { audioGapMs: Math.max(0, value), audioOverlapMs: Math.max(0, -value) };
}

function durationMs(track: TimelineTrackBoundary, first: TimelineSample, last: TimelineSample): number {
  return (numeric(add(last.dts, last.duration)) - numeric(first.dts)) * 1_000 / track.timescale;
}
