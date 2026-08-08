import type { FastifyInstance, FastifyReply } from "fastify";
import { tokenHash } from "../../record/adapters/postgres-playback-run.js";
import type { PlaybackRunRepository } from "../../record/ports/playback-run.js";
import type { FilesystemRecordingStore } from "../../record/adapters/filesystem-recording-store.js";
import { ApiError } from "../errors.js";
import { SharedNetworkShaper } from "../../record/application/network-shaper.js";

export function registerStreamRoutes(server: FastifyInstance, dependencies: { runs: PlaybackRunRepository; store: FilesystemRecordingStore; shaper?: SharedNetworkShaper }): void {
  const shaper = dependencies.shaper ?? new SharedNetworkShaper();
  server.get<{ Params: { "*": string } }>("/streams/fixed-1080/*", async (request, reply) => {
    const requestedPath = request.params["*"];
    if (!validLogicalPath(requestedPath)) throw notFound();
    if (requestedPath !== "index.mpd") return serve(requestedPath, await dependencies.runs.resolveFixedResource(requestedPath), dependencies, shaper, reply);
    const resolved = await dependencies.runs.resolveFixedResource("index.mpd");
    if (!resolved) throw notFound();
    if (resolved === "expired") throw new ApiError(410, "PLAYBACK_RUN_EXPIRED", "Playback run is no longer available");
    try {
      const source = await dependencies.store.readPublishedResource(resolved.storageKey);
      return serveBytes("index.mpd", resolved, select1080pVideo(new TextDecoder().decode(source)), dependencies, shaper, reply);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw notFound();
    }
  });
  server.get<{ Params: { "*": string } }>("/streams/fixed/*", async (request, reply) => {
    const logicalPath = request.params["*"];
    if (!validLogicalPath(logicalPath)) throw notFound();
    const resolved = await dependencies.runs.resolveFixedResource(logicalPath);
    if (logicalPath === "index.mpd" && is1080pControl(resolved)) {
      try {
        const source = await dependencies.store.readPublishedResource(resolved.storageKey);
        return serveBytes(logicalPath, resolved, select1080pVideo(new TextDecoder().decode(source)), dependencies, shaper, reply);
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw notFound();
      }
    }
    return serve(logicalPath, resolved, dependencies, shaper, reply);
  });
  server.get<{ Params: { token: string; "*": string } }>("/streams/:token/*", async (request, reply) => {
    const token = request.params.token;
    const logicalPath = request.params["*"];
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(token) || !validLogicalPath(logicalPath)) throw notFound();
    const resolved = await dependencies.runs.resolveResource(tokenHash(token), logicalPath);
    return serve(logicalPath, resolved, dependencies, shaper, reply);
  });
}

async function serve(logicalPath: string, resolved: Awaited<ReturnType<PlaybackRunRepository["resolveResource"]>>, dependencies: { runs: PlaybackRunRepository; store: FilesystemRecordingStore }, shaper: SharedNetworkShaper, reply: FastifyReply): Promise<unknown> {
  if (!resolved) throw notFound();
  if (resolved === "expired") throw new ApiError(410, "PLAYBACK_RUN_EXPIRED", "Playback run is no longer available");
  try {
    const body = await dependencies.store.readPublishedResource(resolved.storageKey);
    return serveBytes(logicalPath, resolved, body, dependencies, shaper, reply);
  } catch { throw notFound(); }
}

function serveBytes(logicalPath: string, resolved: Exclude<Awaited<ReturnType<PlaybackRunRepository["resolveResource"]>>, "expired" | null>, body: Uint8Array, dependencies: { runs: PlaybackRunRepository }, shaper: SharedNetworkShaper, reply: FastifyReply): unknown {
  reply.header("Cache-Control", "no-store");
  reply.header("Access-Control-Allow-Origin", "*");
  reply.header("Content-Length", String(body.byteLength));
  const shaped = shaper.shape({ runId: resolved.runId, profile: resolved.profile, resourceKind: resolved.resourceKind, body });
  reply.raw.once("finish", () => void dependencies.runs.recordDelivery({ runId: resolved.runId, logicalPath, resourceKind: resolved.resourceKind, ...(typeof resolved.metadata.targetId === "string" ? { targetId: resolved.metadata.targetId } : {}), ...(typeof resolved.metadata.mediaSequence === "number" ? { mediaSequence: resolved.metadata.mediaSequence } : {}), stageIndex: shaped.stageIndex, bandwidthKbps: shaped.stage.bandwidthKbps, latencyMs: shaped.stage.latencyMs, bytesSent: body.byteLength, statusCode: 200, startedAt: new Date().toISOString() }).catch(() => undefined));
  return reply.type(resolved.contentType ?? "application/octet-stream").send(shaped.stream);
}

/** Builds a control MPD from the immutable local MPD. Audio is preserved; only the highest-bitrate 1920x1080 video representation remains. */
function select1080pVideo(source: string): Uint8Array {
  const adaptationSet = /<AdaptationSet\b(?=[^>]*\bcontentType="video")[^>]*>([\s\S]*?)<\/AdaptationSet>/.exec(source);
  if (!adaptationSet?.[1]) throw new ApiError(404, "CONTROL_REPRESENTATION_NOT_FOUND", "This recording has no DASH video adaptation set");
  const candidates = [...adaptationSet[1].matchAll(/<Representation\b([^>]*)>([\s\S]*?)<\/Representation>/g)].map((match) => ({ full: match[0], id: attribute(match[1]!, "id"), width: Number(attribute(match[1]!, "width")), height: Number(attribute(match[1]!, "height")), bandwidth: Number(attribute(match[1]!, "bandwidth")) }))
    .filter((entry) => entry.width === 1920 && entry.height === 1080 && Number.isFinite(entry.bandwidth))
    .sort((left, right) => right.bandwidth - left.bandwidth);
  const selected = candidates[0];
  if (!selected) throw new ApiError(404, "CONTROL_REPRESENTATION_NOT_FOUND", "This recording has no 1920x1080 DASH representation");
  return new TextEncoder().encode(source.replace(adaptationSet[1], selected.full));
}
function attribute(source: string, name: string): string | undefined { return new RegExp(`\\b${name}="([^"]+)"`).exec(source)?.[1]; }
function is1080pControl(resolved: Awaited<ReturnType<PlaybackRunRepository["resolveResource"]>>): resolved is Exclude<Awaited<ReturnType<PlaybackRunRepository["resolveResource"]>>, "expired" | null> {
  return Boolean(resolved && resolved !== "expired" && resolved.profile.name === "1080p control (no ABR)");
}

function validLogicalPath(value: string): boolean {
  return Boolean(value) && value.length <= 512 && !value.split("/").some((part) => !part || part === "." || part === "..");
}
function notFound(): ApiError { return new ApiError(404, "PLAYBACK_RESOURCE_NOT_FOUND", "Playback resource not found"); }
