import type { FastifyInstance, FastifyReply } from "fastify";
import type { PlaybackRunRepository } from "../../record/ports/playback-run.js";
import type { FilesystemRecordingStore } from "../../record/adapters/filesystem-recording-store.js";
import { ApiError } from "../errors.js";
import { SharedNetworkShaper } from "../../record/application/network-shaper.js";
import { baselineNetworkProfile, type NetworkProfile, type PlaybackRun } from "../../record/domain/playback-run.js";

const RECORDING_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The playback URL is fixed per recording, so a device never needs a new URL
 * when a test run starts or ends. Each request resolves the current open
 * playback run to pick the network profile and journal attribution; without an
 * active run the clone is still served under the baseline profile. Only
 * resources registered for the recording are ever read.
 */
export function registerStreamRoutes(server: FastifyInstance, dependencies: { runs: PlaybackRunRepository; store: FilesystemRecordingStore; shaper?: SharedNetworkShaper }): void {
  const shaper = dependencies.shaper ?? new SharedNetworkShaper();
  server.get<{ Params: { recordingId: string; "*": string } }>("/streams/recordings/:recordingId/*", async (request, reply) => {
    const recordingId = parseRecordingId(request.params.recordingId);
    const logicalPath = request.params["*"];
    if (!validLogicalPath(logicalPath)) throw notFound();
    const run = await dependencies.runs.findLatestOpen(recordingId);
    const runId = run?.id ?? recordingId;
    const profile = run?.profile ?? baselineNetworkProfile;
    try {
      const body = await dependencies.store.readPublishedRecordingResource(recordingId, logicalPath);
      return serveBytes(logicalPath, run, runId, profile, body, dependencies.runs, shaper, reply);
    } catch { throw notFound(); }
  });
}

function serveBytes(logicalPath: string, run: PlaybackRun | null, runId: string, profile: NetworkProfile, body: Uint8Array, runs: PlaybackRunRepository, shaper: SharedNetworkShaper, reply: FastifyReply): unknown {
  const resource = describeResource(logicalPath);
  reply.header("Cache-Control", "no-store");
  reply.header("Access-Control-Allow-Origin", "*");
  reply.header("Content-Length", String(body.byteLength));
  const shaped = shaper.shape({ runId, profile, resourceKind: resource.kind, body });
  // The journal is observational only: it never sits on the delivery critical path.
  // Without an active run there is no playback run to attribute deliveries to.
  if (run) {
    reply.raw.once("finish", () => void runs.recordDelivery({ runId: run.id, logicalPath, resourceKind: resource.kind, ...resource.metadata, stageIndex: shaped.stageIndex, bandwidthKbps: shaped.stage.bandwidthKbps, latencyMs: shaped.stage.latencyMs, bytesSent: body.byteLength, statusCode: 200, startedAt: new Date().toISOString() }).catch(() => undefined));
  }
  return reply.type(resource.contentType).send(shaped.stream);
}

function describeResource(logicalPath: string): { kind: string; contentType: string; metadata: { targetId?: string; mediaSequence?: number } } {
  if (logicalPath === "index.m3u8" || logicalPath === "index.mpd") return { kind: "master", contentType: logicalPath.endsWith(".mpd") ? "application/dash+xml" : "application/vnd.apple.mpegurl", metadata: {} };
  if (logicalPath.endsWith("/index.m3u8")) {
    const targetId = logicalPath.split("/")[1];
    return { kind: "media-playlist", contentType: "application/vnd.apple.mpegurl", metadata: targetId ? { targetId } : {} };
  }
  const parts = logicalPath.split("/");
  const targetId = parts[0];
  const video = targetId?.startsWith("video-") || targetId === "variants";
  const sequence = /\/(\d+)\.(?:ts|m4s)$/.exec(logicalPath)?.[1];
  return {
    kind: logicalPath.endsWith("/init.mp4") ? "init-segment" : video ? "video-segment" : "audio-segment",
    contentType: logicalPath.endsWith(".ts") ? "video/mp2t" : video ? "video/mp4" : "audio/mp4",
    metadata: { ...(targetId ? { targetId: targetId === "variants" || targetId === "renditions" ? parts[1] : targetId } : {}), ...(sequence ? { mediaSequence: Number(sequence) } : {}) },
  };
}

function parseRecordingId(value: string): string {
  if (!RECORDING_ID.test(value)) throw new ApiError(400, "INVALID_RECORDING_ID", "Recording ID is invalid");
  return value;
}

function validLogicalPath(value: string): boolean { return Boolean(value) && value.length <= 512 && !value.split("/").some((part) => !part || part === "." || part === ".."); }
function notFound(): ApiError { return new ApiError(404, "PLAYBACK_RESOURCE_NOT_FOUND", "Playback resource not found"); }
