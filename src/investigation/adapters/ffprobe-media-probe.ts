import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { hevcFrameKind, inspectFmp4Fragment, inspectFmp4Init } from "../../stream-tools/isobmff.js";
import type { MediaProbe, MediaProbeResult, MediaProbeTrack } from "../ports/media-sample-collector.js";

const FfprobeOutputSchema = z.object({
  format: z.object({ format_name: z.string().optional(), duration: z.union([z.string(), z.number()]).optional() }).optional(),
  streams: z.array(z.object({
    index: z.number().int(), codec_type: z.string().optional(), codec_name: z.string().optional(),
    duration: z.union([z.string(), z.number()]).optional(), width: z.number().optional(), height: z.number().optional(),
    coded_width: z.number().optional(), coded_height: z.number().optional(), codec_tag_string: z.string().optional(), profile: z.string().optional(), level: z.number().optional(), pix_fmt: z.string().optional(), refs: z.number().optional(),
    time_base: z.string().optional(), avg_frame_rate: z.string().optional(), r_frame_rate: z.string().optional(), color_range: z.string().optional(), color_space: z.string().optional(), color_transfer: z.string().optional(), color_primaries: z.string().optional(), chroma_location: z.string().optional(),
    sample_rate: z.union([z.string(), z.number()]).optional(), channels: z.number().optional(),
  })).optional(),
  packets: z.array(z.object({
    stream_index: z.number().int(), pts: z.union([z.string(), z.number()]).optional(), pts_time: z.union([z.string(), z.number()]).optional(),
    dts: z.union([z.string(), z.number()]).optional(), dts_time: z.union([z.string(), z.number()]).optional(), duration: z.union([z.string(), z.number()]).optional(), duration_time: z.union([z.string(), z.number()]).optional(), size: z.union([z.string(), z.number()]).optional(), pos: z.union([z.string(), z.number()]).optional(), flags: z.string().optional(),
  })).optional(),
  frames: z.array(z.object({
    media_type: z.string().optional(), stream_index: z.number().int().optional(), key_frame: z.union([z.number(), z.boolean()]).optional(), pict_type: z.string().optional(), pts: z.union([z.string(), z.number()]).optional(), pts_time: z.union([z.string(), z.number()]).optional(), pkt_dts: z.union([z.string(), z.number()]).optional(), pkt_dts_time: z.union([z.string(), z.number()]).optional(), best_effort_timestamp: z.union([z.string(), z.number()]).optional(), duration: z.union([z.string(), z.number()]).optional(), width: z.number().optional(), height: z.number().optional(), pix_fmt: z.string().optional(), color_range: z.string().optional(), color_space: z.string().optional(), color_transfer: z.string().optional(), color_primaries: z.string().optional(), side_data_list: z.array(z.object({ side_data_type: z.string().optional() })).optional(),
  })).optional(),
});

export class FfprobeMediaProbe implements MediaProbe {
  constructor(private readonly options: { dataDirectory: string; timeoutMs: number; maxOutputBytes?: number; binary?: string }) {}

  async probe(input: Parameters<MediaProbe["probe"]>[0]): Promise<MediaProbeResult> {
    const directory = path.join(this.options.dataDirectory, "workspaces", input.investigationId);
    const file = path.join(directory, `${input.sample.logicalKey.replace(/[^a-z0-9]+/gi, "-")}.mp4`);
    await fs.mkdir(directory, { recursive: true });
    try {
      await fs.writeFile(file, input.initBytes ? Buffer.concat([input.initBytes, input.sample.content.bytes]) : input.sample.content.bytes);
      const output = await runFfprobe(this.options.binary ?? "ffprobe", file, this.options.timeoutMs, this.options.maxOutputBytes ?? 4_194_304);
      const parsed = FfprobeOutputSchema.safeParse(JSON.parse(output));
      if (!parsed.success) throw new Error("FFprobe returned an invalid media description");
      const packetsByStream = new Map<number, number[]>();
      for (const packet of parsed.data.packets ?? []) {
        const value = finite(packet.pts_time) ?? finite(packet.dts_time);
        if (value === undefined) continue;
        const values = packetsByStream.get(packet.stream_index) ?? [];
        values.push(value);
        packetsByStream.set(packet.stream_index, values);
      }
      const tracks: MediaProbeTrack[] = (parsed.data.streams ?? []).map((stream) => {
        const timestamps = packetsByStream.get(stream.index) ?? [];
        const duration = finite(stream.duration);
        const sampleRate = finite(stream.sample_rate);
        const firstPts = timestamps[0];
        const lastPts = timestamps.at(-1);
        return {
          kind: stream.codec_type === "video" ? "video" : stream.codec_type === "audio" ? "audio" : "other",
          ...(stream.codec_name ? { codec: stream.codec_name } : {}),
          ...(duration === undefined ? {} : { duration }),
          ...(firstPts === undefined ? {} : { firstPts }),
          ...(lastPts === undefined ? {} : { lastPts }),
          ...(stream.width === undefined ? {} : { width: stream.width }),
          ...(stream.height === undefined ? {} : { height: stream.height }),
          ...(stream.r_frame_rate ? { frameRate: stream.r_frame_rate } : {}),
          ...(sampleRate === undefined ? {} : { sampleRate }),
          ...(stream.channels === undefined ? {} : { channels: stream.channels }),
          ...(stream.codec_tag_string ? { codecTagString: stream.codec_tag_string } : {}),
          ...(stream.profile ? { profile: stream.profile } : {}),
          ...(stream.level === undefined ? {} : { level: stream.level }),
          ...(stream.coded_width === undefined ? {} : { codedWidth: stream.coded_width }),
          ...(stream.coded_height === undefined ? {} : { codedHeight: stream.coded_height }),
          ...(stream.pix_fmt ? { pixelFormat: stream.pix_fmt } : {}),
          ...(stream.refs === undefined ? {} : { refs: stream.refs }),
          ...(stream.time_base ? { timeBase: stream.time_base } : {}),
          ...(stream.avg_frame_rate ? { averageFrameRate: stream.avg_frame_rate } : {}),
          ...(stream.color_range ? { colorRange: stream.color_range } : {}),
          ...(stream.color_space ? { colorSpace: stream.color_space } : {}),
          ...(stream.color_transfer ? { colorTransfer: stream.color_transfer } : {}),
          ...(stream.color_primaries ? { colorPrimaries: stream.color_primaries } : {}),
          ...(stream.chroma_location ? { chromaLocation: stream.chroma_location } : {}),
        };
      });
      const duration = finite(parsed.data.format?.duration);
      const isFragmentedMp4 = Boolean(input.initBytes) || looksLikeIsoBmff(input.sample.content.bytes);
      const init = input.initBytes && isFragmentedMp4 ? inspectFmp4Init(input.initBytes) : undefined;
      const fragment = isFragmentedMp4 ? inspectFmp4Fragment(input.sample.content.bytes, init?.nalLengthSize ?? 4) : undefined;
      return {
        ...(parsed.data.format?.format_name ? { format: parsed.data.format.format_name } : {}),
        ...(duration === undefined ? {} : { duration }),
        tracks,
        boundary: buildBoundarySummary(parsed.data.packets ?? [], parsed.data.frames ?? []),
        ...(fragment ? { fmp4: {
          ...(init ? { init } : {}),
          fragment: {
            ...(fragment.styp ? { styp: fragment.styp } : {}),
            ...(fragment.sidx ? { sidx: fragment.sidx } : {}),
            ...(fragment.sequenceNumber === undefined ? {} : { sequenceNumber: fragment.sequenceNumber }),
            ...(fragment.baseMediaDecodeTime === undefined ? {} : { baseMediaDecodeTime: String(fragment.baseMediaDecodeTime) }),
            trafs: fragment.trafs,
            // Keep only the first/last three samples in structured evidence.
            // The complete media artifact remains stored for later drill-down.
            samples: boundaryItems(fragment.samples).map((sample) => ({
              dts: String(sample.dts), pts: String(sample.pts),
              ...(sample.duration === undefined ? {} : { duration: String(sample.duration) }),
              ...(sample.size === undefined ? {} : { size: sample.size }),
              ...(sample.flags === undefined ? {} : { flags: sample.flags }),
              ...(sample.sync === undefined ? {} : { sync: sample.sync }),
              ...(sample.compositionOffset === undefined ? {} : { compositionOffset: String(sample.compositionOffset) }),
              nalTypes: sample.nalTypes,
              accessUnit: sample.accessUnit,
              firstFrameKind: hevcFrameKind(sample.nalTypes),
            })),
            drmBoxTypes: fragment.drmBoxTypes,
            structuralErrors: fragment.structuralErrors,
          },
        } } : {}),
      };
    } finally {
      await fs.rm(file, { force: true }).catch(() => undefined);
    }
  }
}

type ParsedPacket = NonNullable<z.infer<typeof FfprobeOutputSchema>["packets"]>[number];
type ParsedFrame = NonNullable<z.infer<typeof FfprobeOutputSchema>["frames"]>[number];

function buildBoundarySummary(packets: ParsedPacket[], frames: ParsedFrame[]): NonNullable<MediaProbeResult["boundary"]> {
  return {
    totalPacketCount: packets.length,
    totalFrameCount: frames.length,
    packets: boundaryItems(packets).map(toBoundaryPacket),
    frames: boundaryItems(frames).map(toBoundaryFrame),
  };
}

function toBoundaryPacket(packet: ParsedPacket): NonNullable<MediaProbeResult["boundary"]>["packets"][number] {
  const pts = stringValue(packet.pts); const ptsTime = finite(packet.pts_time); const dts = stringValue(packet.dts); const dtsTime = finite(packet.dts_time);
  const duration = stringValue(packet.duration); const durationTime = finite(packet.duration_time); const size = finite(packet.size); const pos = stringValue(packet.pos);
  return { ...(pts ? { pts } : {}), ...(ptsTime === undefined ? {} : { ptsTime }), ...(dts ? { dts } : {}), ...(dtsTime === undefined ? {} : { dtsTime }), ...(duration ? { duration } : {}), ...(durationTime === undefined ? {} : { durationTime }), ...(size === undefined ? {} : { size }), ...(pos ? { pos } : {}), ...(packet.flags ? { flags: packet.flags } : {}) };
}

function toBoundaryFrame(frame: ParsedFrame): NonNullable<MediaProbeResult["boundary"]>["frames"][number] {
  const pts = stringValue(frame.pts); const ptsTime = finite(frame.pts_time); const packetDts = stringValue(frame.pkt_dts); const packetDtsTime = finite(frame.pkt_dts_time); const bestEffortTimestamp = stringValue(frame.best_effort_timestamp); const duration = stringValue(frame.duration);
  return {
      ...(frame.key_frame === undefined ? {} : { keyFrame: frame.key_frame === true || frame.key_frame === 1 }),
      ...(frame.pict_type ? { pictureType: frame.pict_type } : {}),
      ...(pts ? { pts } : {}),
      ...(ptsTime === undefined ? {} : { ptsTime }),
      ...(packetDts ? { packetDts } : {}),
      ...(packetDtsTime === undefined ? {} : { packetDtsTime }),
      ...(bestEffortTimestamp ? { bestEffortTimestamp } : {}),
      ...(duration ? { duration } : {}),
      ...(frame.width === undefined ? {} : { width: frame.width }),
      ...(frame.height === undefined ? {} : { height: frame.height }),
      ...(frame.pix_fmt ? { pixelFormat: frame.pix_fmt } : {}),
      ...(frame.color_range ? { colorRange: frame.color_range } : {}),
      ...(frame.color_space ? { colorSpace: frame.color_space } : {}),
      ...(frame.color_transfer ? { colorTransfer: frame.color_transfer } : {}),
      ...(frame.color_primaries ? { colorPrimaries: frame.color_primaries } : {}),
      sideDataTypes: (frame.side_data_list ?? []).flatMap((entry) => entry.side_data_type ? [entry.side_data_type] : []),
  };
}

function boundaryItems<T>(values: T[]): T[] { return values.length <= 6 ? values : [...values.slice(0, 3), ...values.slice(-3)]; }
function stringValue(value: string | number | undefined): string | undefined { return value === undefined ? undefined : String(value); }

function looksLikeIsoBmff(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 8) return false;
  const type = String.fromCharCode(...bytes.subarray(4, 8));
  return type === "styp" || type === "moof" || type === "ftyp";
}

function finite(value: string | number | undefined): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function runFfprobe(binary: string, input: string, timeoutMs: number, maxOutputBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, [
      "-v", "error", "-show_format", "-show_streams", "-show_packets", "-show_frames",
      "-show_entries", "format=format_name,duration:stream=index,codec_type,codec_name,codec_tag_string,profile,level,duration,width,height,coded_width,coded_height,pix_fmt,refs,time_base,avg_frame_rate,r_frame_rate,color_range,color_space,color_transfer,color_primaries,chroma_location,sample_rate,channels:packet=stream_index,pts,pts_time,dts,dts_time,duration,duration_time,size,pos,flags:frame=media_type,stream_index,key_frame,pict_type,pts,pts_time,pkt_dts,pkt_dts_time,best_effort_timestamp,duration,width,height,pix_fmt,color_range,color_space,color_transfer,color_primaries,side_data_list",
      "-of", "json", input,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (callback: () => void): void => { if (!settled) { settled = true; clearTimeout(timer); callback(); } };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(() => reject(new Error("FFprobe timed out")));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
      if (Buffer.byteLength(stdout) > maxOutputBytes) {
        child.kill("SIGKILL");
        finish(() => reject(new Error("FFprobe output exceeded the allowed size")));
      }
    });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf-8"); });
    child.once("error", () => finish(() => reject(new Error("FFprobe is unavailable"))));
    child.once("close", (code) => {
      if (code === 0) finish(() => resolve(stdout));
      else finish(() => reject(new Error(`FFprobe failed${stderr.trim() ? `: ${stderr.trim().slice(0, 300)}` : ""}`)));
    });
  });
}
