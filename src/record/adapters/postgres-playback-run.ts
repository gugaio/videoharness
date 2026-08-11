import { randomUUID } from "node:crypto";
import type pg from "pg";
import { baselineNetworkProfile, type NetworkProfile, type PlaybackRun } from "../domain/playback-run.js";
import type { CreatedPlaybackRun, DeliveryRequest, PlaybackRunRepository, RecordedDiagnosticResource } from "../ports/playback-run.js";

type RunRow = { id: string; recording_id: string; protocol?: "hls" | "dash"; state: PlaybackRun["state"]; max_duration_seconds: number; network_profile: NetworkProfile | null; created_at: Date; first_media_request_at: Date | null; expires_at: Date; completed_at: Date | null; error_code: string | null; error_message: string | null };
type DeliveryRow = { id: string; logical_path: string; resource_kind: string; target_id: string | null; media_sequence: number | null; stage_index: number; bandwidth_kbps: number; latency_ms: number; bytes_sent: string | number; status_code: number; started_at: Date; completed_at: Date; metadata: Record<string, unknown> };
type DiagnosticResourceRow = { logical_path: string; kind: string; size_bytes: string | number; sha256: string; metadata: Record<string, unknown> };

export class PostgresPlaybackRuns implements PlaybackRunRepository {
  constructor(private readonly pool: pg.Pool) {}

  async create(recordingId: string, maxDurationSeconds: number, profile: NetworkProfile): Promise<CreatedPlaybackRun | "recording_not_ready"> {
    const result = await this.pool.query<RunRow>(
      `INSERT INTO playback_runs (id, recording_id, state, max_duration_seconds, network_profile, expires_at)
       SELECT $1, id, 'created', $2, $3::jsonb, now() + interval '24 hours'
         FROM recordings WHERE id = $4 AND state = 'ready'
       RETURNING *, (SELECT protocol FROM recordings WHERE recordings.id = playback_runs.recording_id) AS protocol`, [randomUUID(), maxDurationSeconds, JSON.stringify(profile), recordingId]);
    return result.rows[0] ? { run: toRun(result.rows[0]), manifestPath: result.rows[0].protocol === "dash" ? "index.mpd" : "index.m3u8" } : "recording_not_ready";
  }

  async findById(recordingId: string, runId: string): Promise<PlaybackRun | null> {
    const result = await this.pool.query<RunRow>(`SELECT * FROM playback_runs WHERE id = $1 AND recording_id = $2`, [runId, recordingId]);
    return result.rows[0] ? toRun(result.rows[0]) : null;
  }

  async findLatestOpen(recordingId: string): Promise<PlaybackRun | null> {
    await this.pool.query(`UPDATE playback_runs SET state = 'expired' WHERE recording_id = $1 AND state IN ('created', 'active') AND expires_at <= now()`, [recordingId]);
    const result = await this.pool.query<RunRow>(`SELECT * FROM playback_runs WHERE recording_id = $1 AND state IN ('created', 'active') AND expires_at > now() ORDER BY created_at DESC LIMIT 1`, [recordingId]);
    return result.rows[0] ? toRun(result.rows[0]) : null;
  }

  async finish(recordingId: string, runId: string): Promise<PlaybackRun | null> {
    const result = await this.pool.query<RunRow>(`UPDATE playback_runs SET state = 'completed', completed_at = now()
      WHERE id = $1 AND recording_id = $2 AND state IN ('created', 'active') RETURNING *`, [runId, recordingId]);
    return result.rows[0] ? toRun(result.rows[0]) : null;
  }

  async recordDelivery(input: Omit<DeliveryRequest, "id" | "completedAt"> & { runId: string }): Promise<void> {
    await this.pool.query(`INSERT INTO delivery_requests (playback_run_id, logical_path, resource_kind, target_id, media_sequence, stage_index, bandwidth_kbps, latency_ms, bytes_sent, status_code, started_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [input.runId, input.logicalPath, input.resourceKind, input.targetId ?? null, input.mediaSequence ?? null, input.stageIndex, input.bandwidthKbps, input.latencyMs, input.bytesSent, input.statusCode, input.startedAt]);
  }

  async listDeliveries(recordingId: string, runId: string, limit: number): Promise<DeliveryRequest[]> {
    const result = await this.pool.query<DeliveryRow>(`SELECT delivery_requests.*, recorded_resources.metadata FROM delivery_requests JOIN playback_runs ON playback_runs.id = delivery_requests.playback_run_id JOIN recorded_resources ON recorded_resources.recording_id = playback_runs.recording_id AND recorded_resources.logical_path = delivery_requests.logical_path WHERE playback_runs.recording_id=$1 AND delivery_requests.playback_run_id=$2 ORDER BY delivery_requests.id DESC LIMIT $3`, [recordingId, runId, limit]);
    return result.rows.map((row) => ({ id: row.id, logicalPath: row.logical_path, resourceKind: row.resource_kind, ...(row.target_id ? { targetId: row.target_id } : {}), ...(row.media_sequence === null ? {} : { mediaSequence: row.media_sequence }), ...(typeof row.metadata.bandwidth === "number" ? { variantBandwidth: row.metadata.bandwidth } : {}), ...(typeof row.metadata.resolution === "string" ? { variantResolution: row.metadata.resolution } : {}), stageIndex: row.stage_index, bandwidthKbps: row.bandwidth_kbps, latencyMs: row.latency_ms, bytesSent: Number(row.bytes_sent), statusCode: row.status_code, startedAt: row.started_at.toISOString(), completedAt: row.completed_at.toISOString() }));
  }

  async listDiagnosticResources(recordingId: string): Promise<RecordedDiagnosticResource[]> {
    const result = await this.pool.query<DiagnosticResourceRow>(`SELECT logical_path, kind, size_bytes, sha256, metadata FROM recorded_resources WHERE recording_id = $1 ORDER BY logical_path`, [recordingId]);
    return result.rows.map((row) => ({ logicalPath: row.logical_path, resourceKind: row.kind, sizeBytes: Number(row.size_bytes), sha256: row.sha256, metadata: row.metadata }));
  }

}

function toRun(row: RunRow): PlaybackRun { return { id: row.id, recordingId: row.recording_id, state: row.state, maxDurationSeconds: row.max_duration_seconds, profile: row.network_profile ?? baselineNetworkProfile, createdAt: row.created_at.toISOString(), expiresAt: row.expires_at.toISOString(), ...(row.first_media_request_at ? { firstMediaRequestAt: row.first_media_request_at.toISOString() } : {}), ...(row.completed_at ? { completedAt: row.completed_at.toISOString() } : {}), ...(row.error_code ? { errorCode: row.error_code } : {}), ...(row.error_message ? { errorMessage: row.error_message } : {}) }; }
