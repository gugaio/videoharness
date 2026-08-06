import type { FastifyInstance } from "fastify";
import { CreateRecordingRequestSchema } from "../../contracts/recording.js";
import type { RecordingQueries } from "../../record/application/recording-queries.js";
import type { StartRecording } from "../../record/application/start-recording.js";
import type { RecordingEvent } from "../../record/domain/recording-event.js";
import { RecordingIdempotencyConflictError } from "../../record/ports/recording-intake.js";
import { ApiError } from "../errors.js";
import { CreatePlaybackRunRequestSchema } from "../../contracts/recording.js";
import type { CreatePlaybackRun } from "../../record/application/playback-runs.js";
import type { PlaybackRunRepository } from "../../record/ports/playback-run.js";

/** Registered by the production composition root after an HLS materializer is configured. */
export function registerRecordingRoutes(server: FastifyInstance, dependencies: { startRecording: StartRecording; queries: RecordingQueries; createPlaybackRun?: CreatePlaybackRun; playbackRuns?: PlaybackRunRepository }): void {
  server.post<{ Body: unknown }>("/v1/recordings", async (request, reply) => {
    const parsed = CreateRecordingRequestSchema.safeParse(request.body);
    if (!parsed.success) throw new ApiError(400, "INVALID_REQUEST", "A valid HLS URL and bounded recording window are required");
    const header = request.headers["idempotency-key"];
    const idempotencyKey = Array.isArray(header) ? header[0]?.trim() : header?.trim();
    if (!idempotencyKey || idempotencyKey.length > 200) {
      throw new ApiError(400, "INVALID_IDEMPOTENCY_KEY", "A valid Idempotency-Key header is required");
    }
    try {
      const result = await dependencies.startRecording({
        sourceUrl: parsed.data.url,
        durationSeconds: parsed.data.durationSeconds,
        startSeconds: parsed.data.startSeconds,
        idempotencyKey,
      });
      if (!result.created) reply.header("x-idempotency-replayed", "true");
      return reply.status(202).send({ recording: result.recording, replayed: !result.created });
    } catch (error) {
      if (error instanceof RecordingIdempotencyConflictError) {
        throw new ApiError(409, "IDEMPOTENCY_CONFLICT", error.message);
      }
      throw error;
    }
  });

  server.get<{ Params: { id: string } }>("/v1/recordings/:id", async (request) => {
    const id = parseRecordingId(request.params.id);
    const recording = await dependencies.queries.getRecording(id);
    if (!recording) throw new ApiError(404, "RECORDING_NOT_FOUND", "Recording not found");
    return { recording };
  });

  server.get<{ Params: { id: string } }>("/v1/recordings/:id/events", async (request, reply) => {
    const id = parseRecordingId(request.params.id);
    const recording = await dependencies.queries.getRecording(id);
    if (!recording) throw new ApiError(404, "RECORDING_NOT_FOUND", "Recording not found");
    reply.hijack();
    const response = reply.raw;
    response.statusCode = 200;
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.setHeader("X-Accel-Buffering", "no");
    response.flushHeaders?.();

    let closed = false;
    let polling = false;
    let cursor = parseEventCursor(request.headers["last-event-id"]);
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let pingTimer: ReturnType<typeof setInterval> | undefined;
    const cleanup = (): void => {
      if (closed) return;
      closed = true;
      if (pollTimer) clearInterval(pollTimer);
      if (pingTimer) clearInterval(pingTimer);
      response.end();
    };
    const writeEvents = async (): Promise<void> => {
      if (closed || polling) return;
      polling = true;
      try {
        for (const event of await dependencies.queries.listEventsAfter(id, cursor)) {
          if (closed) return;
          response.write(formatRecordingSseEvent(event));
          cursor = event.id;
        }
      } finally { polling = false; }
    };
    try { await writeEvents(); } catch { cleanup(); return; }
    pollTimer = setInterval(() => void writeEvents().catch(cleanup), 750);
    pingTimer = setInterval(() => { if (!closed) response.write(`event: ping\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`); }, 15_000);
    request.raw.once("close", cleanup);
    request.raw.once("error", cleanup);
  });

  server.post<{ Params: { id: string }; Body: unknown }>("/v1/recordings/:id/playback-runs", async (request, reply) => {
    if (!dependencies.createPlaybackRun) throw new ApiError(503, "PLAYBACK_UNAVAILABLE", "Playback delivery is not configured");
    const recordingId = parseRecordingId(request.params.id);
    const parsed = CreatePlaybackRunRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) throw new ApiError(400, "INVALID_PLAYBACK_RUN", "Playback duration must be between 30 and 900 seconds");
    const created = await dependencies.createPlaybackRun({ recordingId, maxDurationSeconds: parsed.data.maxDurationSeconds, profile: parsed.data.profile });
    if (created === "recording_not_ready") throw new ApiError(409, "RECORDING_NOT_READY", "Playback is available when the recording is ready");
    return reply.status(201).send({ run: created.run, playbackUrl: `/streams/${created.playbackToken}/index.m3u8` });
  });

  server.get<{ Params: { id: string; runId: string }; Querystring: { limit?: string } }>("/v1/recordings/:id/playback-runs/:runId/requests", async (request) => {
    if (!dependencies.playbackRuns) throw new ApiError(503, "PLAYBACK_UNAVAILABLE", "Playback delivery is not configured");
    const recordingId = parseRecordingId(request.params.id);
    if (!/^[0-9a-f-]{36}$/i.test(request.params.runId)) throw new ApiError(400, "INVALID_PLAYBACK_RUN_ID", "Playback run ID is invalid");
    const raw = Number(request.query.limit ?? 10);
    const limit = Number.isSafeInteger(raw) ? Math.min(100, Math.max(1, raw)) : 10;
    return { requests: await dependencies.playbackRuns.listDeliveries(recordingId, request.params.runId, limit) };
  });
}

function parseRecordingId(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new ApiError(400, "INVALID_RECORDING_ID", "Recording ID is invalid");
  }
  return value;
}

function parseEventCursor(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  return value && /^\d+$/.test(value) ? value : "0";
}

export function formatRecordingSseEvent(event: RecordingEvent): string {
  return `id: ${event.id}\nevent: recording.event\ndata: ${JSON.stringify(event)}\n\n`;
}
