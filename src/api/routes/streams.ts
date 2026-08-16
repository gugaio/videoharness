import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PlaybackRunRepository } from "../../record/ports/playback-run.js";
import type { FilesystemRecordingStore } from "../../record/adapters/filesystem-recording-store.js";
import { ApiError } from "../errors.js";
import { SharedNetworkShaper } from "../../record/application/network-shaper.js";
import { baselineNetworkProfile, type NetworkProfile, type PlaybackRun } from "../../record/domain/playback-run.js";
import type { ExperimentStreamResolver } from "../../experiment/ports/experiment-repository.js";
import { PlaybackFaultInjector } from "../../record/application/fault-plan.js";

const RECORDING_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STREAM_ROUTE = "/streams/recordings/:recordingId/*";
const EXPERIMENT_STREAM_ROUTE = "/streams/experiments/:experimentId/*";
const CORS_METHODS = "GET, HEAD, OPTIONS";
const CORS_HEADERS = "Range";
const EXPOSED_HEADERS = "Accept-Ranges, Content-Length, Content-Range";

type StreamRoute = { Params: { recordingId: string; "*": string } };
type ExperimentStreamRoute = { Params: { experimentId: string; "*": string } };
type ByteRange = { start: number; end: number };

/**
 * The playback URL is fixed per recording, so a device never needs a new URL
 * when a test run starts or ends. Each GET resolves the current open playback
 * run to pick the network profile and journal attribution; HEAD and OPTIONS are
 * observational and never advance shaping. Only published resources are read.
 */
export function registerStreamRoutes(server: FastifyInstance, dependencies: { runs: PlaybackRunRepository; store: FilesystemRecordingStore; experiments?: ExperimentStreamResolver; shaper?: SharedNetworkShaper; faults?: PlaybackFaultInjector }): void {
  const shaper = dependencies.shaper ?? new SharedNetworkShaper();
  const faults = dependencies.faults ?? new PlaybackFaultInjector();
  const serve = async (request: FastifyRequest<StreamRoute>, reply: FastifyReply): Promise<unknown> => {
    setCorsHeaders(reply);
    const recordingId = parseRecordingId(request.params.recordingId);
    const logicalPath = request.params["*"];
    if (!validLogicalPath(logicalPath)) throw notFound();

    let body: Uint8Array;
    try {
      body = await dependencies.store.readPublishedRecordingResource(recordingId, logicalPath);
    } catch {
      throw notFound();
    }

    if (request.method === "HEAD") return serveHead(logicalPath, request.headers.range, body, reply);

    const run = await dependencies.runs.findLatestOpen(recordingId);
    return serveGet({
      logicalPath,
      rangeHeader: request.headers.range,
      run,
      runId: run?.id ?? recordingId,
      profile: run?.profile ?? baselineNetworkProfile,
      body,
      runs: dependencies.runs,
      shaper,
      faults,
      reply,
    });
  };

  server.get<StreamRoute>(STREAM_ROUTE, { exposeHeadRoute: false }, serve);
  server.head<StreamRoute>(STREAM_ROUTE, serve);
  server.options<StreamRoute>(STREAM_ROUTE, async (request, reply) => {
    setCorsHeaders(reply);
    parseRecordingId(request.params.recordingId);
    if (!validLogicalPath(request.params["*"])) throw notFound();
    reply.header("Access-Control-Max-Age", "86400");
    return reply.status(204).send();
  });

  if (dependencies.experiments) {
    const serveExperiment = async (request: FastifyRequest<ExperimentStreamRoute>, reply: FastifyReply): Promise<unknown> => {
      setCorsHeaders(reply);
      const experimentId = parseExperimentId(request.params.experimentId);
      const logicalPath = request.params["*"];
      if (!validLogicalPath(logicalPath)) throw notFound();
      const active = await dependencies.experiments!.resolveActiveStream(experimentId);
      if (!active) throw new ApiError(409, "EXPERIMENT_TREATMENT_NOT_SELECTED", "Select a ready experiment treatment before starting playback");

      let body: Uint8Array;
      try {
        body = await dependencies.store.readPublishedRecordingResource(active.recordingId, logicalPath);
      } catch {
        throw notFound();
      }
      if (request.method === "HEAD") return serveHead(logicalPath, request.headers.range, body, reply);
      const run = await dependencies.runs.findLatestOpen(active.recordingId);
      return serveGet({
        logicalPath,
        rangeHeader: request.headers.range,
        run,
        runId: run?.id ?? active.testRequestId,
        profile: run?.profile ?? baselineNetworkProfile,
        body,
        runs: dependencies.runs,
        shaper,
        faults,
        reply,
      });
    };
    server.get<ExperimentStreamRoute>(EXPERIMENT_STREAM_ROUTE, { exposeHeadRoute: false }, serveExperiment);
    server.head<ExperimentStreamRoute>(EXPERIMENT_STREAM_ROUTE, serveExperiment);
    server.options<ExperimentStreamRoute>(EXPERIMENT_STREAM_ROUTE, async (request, reply) => {
      setCorsHeaders(reply);
      parseExperimentId(request.params.experimentId);
      if (!validLogicalPath(request.params["*"])) throw notFound();
      reply.header("Access-Control-Max-Age", "86400");
      return reply.status(204).send();
    });
  }
}

function serveGet(input: { logicalPath: string; rangeHeader: string | undefined; run: PlaybackRun | null; runId: string; profile: NetworkProfile; body: Uint8Array; runs: PlaybackRunRepository; shaper: SharedNetworkShaper; faults: PlaybackFaultInjector; reply: FastifyReply }): unknown {
  const resource = describeResource(input.logicalPath);
  const appliedFault = input.run ? input.faults.select(input.run.id, input.run.faultPlan, { kind: resource.kind, ...resource.metadata }) : undefined;
  const fault = appliedFault?.rule;
  const startedAt = new Date().toISOString();
  if (fault?.action.type === "status") {
    const shaped = input.shaper.shape({ runId: input.runId, profile: input.profile, resourceKind: resource.kind, body: new Uint8Array(), additionalLatencyMs: 0 });
    recordOnFinish(input, resource, shaped.stageIndex, shaped.stage.bandwidthKbps, shaped.stage.latencyMs, 0, fault.action.statusCode, startedAt, fault.id, fault.action.type);
    return input.reply.status(fault.action.statusCode).type(resource.contentType).send(shaped.stream);
  }
  const response = prepareResponse(input.rangeHeader, input.body, input.reply);
  const bytes = fault?.action.type === "truncate_body" ? response.bytes.subarray(0, Math.min(fault.action.keepBytes, response.bytes.byteLength)) : response.bytes;
  if (fault?.action.type === "truncate_body") input.reply.header("Content-Length", String(bytes.byteLength));
  const shaped = input.shaper.shape({
    runId: input.runId,
    profile: input.profile,
    resourceKind: resource.kind,
    body: bytes,
    additionalLatencyMs: fault?.action.type === "delay" ? fault.action.delayMs : 0,
  });

  // The journal is observational only: it never sits on the delivery critical path.
  // Without an active run there is no playback run to attribute deliveries to.
  recordOnFinish(input, resource, shaped.stageIndex, shaped.stage.bandwidthKbps, shaped.stage.latencyMs, bytes.byteLength, response.statusCode, startedAt, fault?.id, fault?.action.type);
  return input.reply.status(response.statusCode).type(resource.contentType).send(shaped.stream);
}

function recordOnFinish(input: { logicalPath: string; run: PlaybackRun | null; runs: PlaybackRunRepository; reply: FastifyReply }, resource: ReturnType<typeof describeResource>, stageIndex: number, bandwidthKbps: number, latencyMs: number, bytesSent: number, statusCode: number, startedAt: string, faultRuleId?: string, faultAction?: string): void {
  if (!input.run) return;
  input.reply.raw.once("finish", () => void input.runs.recordDelivery({
    runId: input.run!.id,
    logicalPath: input.logicalPath,
    resourceKind: resource.kind,
    ...resource.metadata,
    stageIndex,
    bandwidthKbps,
    latencyMs,
    bytesSent,
    statusCode,
    startedAt,
    ...(faultRuleId ? { faultRuleId } : {}),
    ...(faultAction ? { faultAction } : {}),
  }).catch(() => undefined));
}

function serveHead(logicalPath: string, rangeHeader: string | undefined, body: Uint8Array, reply: FastifyReply): unknown {
  const { statusCode } = prepareResponse(rangeHeader, body, reply);
  return reply.status(statusCode).type(describeResource(logicalPath).contentType).send();
}

function prepareResponse(rangeHeader: string | undefined, body: Uint8Array, reply: FastifyReply): { bytes: Uint8Array; statusCode: 200 | 206 } {
  reply.header("Cache-Control", "no-store");
  reply.header("Accept-Ranges", "bytes");
  const range = parseRange(rangeHeader, body.byteLength);
  if (range === "unsatisfiable") {
    reply.header("Content-Range", `bytes */${body.byteLength}`);
    throw new ApiError(416, "INVALID_PLAYBACK_RANGE", "Playback range is invalid");
  }
  if (!range) {
    reply.header("Content-Length", String(body.byteLength));
    return { bytes: body, statusCode: 200 };
  }

  const bytes = body.subarray(range.start, range.end + 1);
  reply.header("Content-Length", String(bytes.byteLength));
  reply.header("Content-Range", `bytes ${range.start}-${range.end}/${body.byteLength}`);
  return { bytes, statusCode: 206 };
}

function parseRange(value: string | undefined, length: number): ByteRange | "unsatisfiable" | null {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim());
  if (!match || (!match[1] && !match[2]) || length === 0) return "unsatisfiable";

  if (!match[1]) {
    const suffixLength = parseRangeInteger(match[2]);
    if (suffixLength === null || suffixLength === 0) return "unsatisfiable";
    return { start: Math.max(0, length - suffixLength), end: length - 1 };
  }

  const start = parseRangeInteger(match[1]);
  const requestedEnd = match[2] ? parseRangeInteger(match[2]) : length - 1;
  if (start === null || requestedEnd === null || start >= length || requestedEnd < start) return "unsatisfiable";
  return { start, end: Math.min(requestedEnd, length - 1) };
}

function parseRangeInteger(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function setCorsHeaders(reply: FastifyReply): void {
  reply.header("Access-Control-Allow-Origin", "*");
  reply.header("Access-Control-Allow-Methods", CORS_METHODS);
  reply.header("Access-Control-Allow-Headers", CORS_HEADERS);
  reply.header("Access-Control-Expose-Headers", EXPOSED_HEADERS);
  reply.header("Cross-Origin-Resource-Policy", "cross-origin");
}

export function describeResource(logicalPath: string): { kind: string; contentType: string; metadata: { targetId?: string; mediaSequence?: number } } {
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

function parseExperimentId(value: string): string {
  if (!RECORDING_ID.test(value)) throw new ApiError(400, "INVALID_EXPERIMENT_ID", "Experiment ID is invalid");
  return value;
}

function validLogicalPath(value: string): boolean { return Boolean(value) && value.length <= 512 && !value.split("/").some((part) => !part || part === "." || part === ".."); }
function notFound(): ApiError { return new ApiError(404, "PLAYBACK_RESOURCE_NOT_FOUND", "Playback resource not found"); }
