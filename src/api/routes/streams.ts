import type { FastifyInstance } from "fastify";
import { tokenHash } from "../../record/adapters/postgres-playback-run.js";
import type { PlaybackRunRepository } from "../../record/ports/playback-run.js";
import type { FilesystemRecordingStore } from "../../record/adapters/filesystem-recording-store.js";
import { ApiError } from "../errors.js";
import { SharedNetworkShaper } from "../../record/application/network-shaper.js";

export function registerStreamRoutes(server: FastifyInstance, dependencies: { runs: PlaybackRunRepository; store: FilesystemRecordingStore; shaper?: SharedNetworkShaper }): void {
  const shaper = dependencies.shaper ?? new SharedNetworkShaper();
  server.get<{ Params: { token: string; "*": string } }>("/streams/:token/*", async (request, reply) => {
    const token = request.params.token;
    const logicalPath = request.params["*"];
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(token) || !validLogicalPath(logicalPath)) throw notFound();
    const resolved = await dependencies.runs.resolveResource(tokenHash(token), logicalPath);
    if (!resolved) throw notFound();
    if (resolved === "expired") throw new ApiError(410, "PLAYBACK_RUN_EXPIRED", "Playback run is no longer available");
    try {
      const body = await dependencies.store.readPublishedResource(resolved.storageKey);
      reply.header("Cache-Control", "no-store");
      reply.header("Access-Control-Allow-Origin", "*");
      reply.header("Content-Length", String(body.byteLength));
      const shaped = shaper.shape({
        runId: resolved.runId, profile: resolved.profile, resourceKind: resolved.resourceKind, body,
      });
      reply.raw.once("finish", () => void dependencies.runs.recordDelivery({
        runId: resolved.runId, logicalPath, resourceKind: resolved.resourceKind,
        ...(typeof resolved.metadata.targetId === "string" ? { targetId: resolved.metadata.targetId } : {}),
        ...(typeof resolved.metadata.mediaSequence === "number" ? { mediaSequence: resolved.metadata.mediaSequence } : {}),
        stageIndex: shaped.stageIndex, bandwidthKbps: shaped.stage.bandwidthKbps, latencyMs: shaped.stage.latencyMs,
        bytesSent: body.byteLength, statusCode: 200, startedAt: new Date().toISOString(),
      }).catch(() => undefined));
      return reply.type(resolved.contentType ?? "application/octet-stream").send(shaped.stream);
    } catch {
      throw notFound();
    }
  });
}

function validLogicalPath(value: string): boolean {
  return Boolean(value) && value.length <= 512 && !value.split("/").some((part) => !part || part === "." || part === "..");
}
function notFound(): ApiError { return new ApiError(404, "PLAYBACK_RESOURCE_NOT_FOUND", "Playback resource not found"); }
