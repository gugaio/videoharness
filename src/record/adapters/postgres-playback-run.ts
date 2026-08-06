import { createHash, randomBytes, randomUUID } from "node:crypto";
import type pg from "pg";
import { baselineNetworkProfile, type NetworkProfile, type PlaybackRun } from "../domain/playback-run.js";
import type { CreatedPlaybackRun, DeliveryRequest, PlaybackRunRepository, ResolvedPlaybackResource } from "../ports/playback-run.js";

type RunRow = { id: string; recording_id: string; state: PlaybackRun["state"]; max_duration_seconds: number; network_profile: NetworkProfile | null; created_at: Date; first_media_request_at: Date | null; expires_at: Date; completed_at: Date | null; error_code: string | null; error_message: string | null };
type ResourceRow = { id: string; state: PlaybackRun["state"]; storage_key: string; content_type: string | null; size_bytes: string | number; expires_at: Date; kind: string; max_duration_seconds: number; network_profile: NetworkProfile | null; metadata: Record<string, unknown> };
type DeliveryRow = { id: string; logical_path: string; resource_kind: string; target_id: string | null; media_sequence: number | null; stage_index: number; bandwidth_kbps: number; latency_ms: number; bytes_sent: string | number; status_code: number; started_at: Date; completed_at: Date; metadata: Record<string, unknown> };

export class PostgresPlaybackRuns implements PlaybackRunRepository {
  constructor(private readonly pool: pg.Pool) {}

  async create(recordingId: string, maxDurationSeconds: number, profile: NetworkProfile): Promise<CreatedPlaybackRun | "recording_not_ready"> {
    const token = randomBytes(32).toString("base64url");
    const result = await this.pool.query<RunRow>(
      `INSERT INTO playback_runs (id, recording_id, token_hash, state, max_duration_seconds, network_profile, expires_at)
       SELECT $1, id, $2, 'created', $3, $4::jsonb, now() + interval '15 minutes'
         FROM recordings WHERE id = $5 AND state = 'ready'
       RETURNING *`, [randomUUID(), tokenHash(token), maxDurationSeconds, JSON.stringify(profile), recordingId]);
    return result.rows[0] ? { run: toRun(result.rows[0]), playbackToken: token } : "recording_not_ready";
  }

  async findById(recordingId: string, runId: string): Promise<PlaybackRun | null> {
    const result = await this.pool.query<RunRow>(`SELECT * FROM playback_runs WHERE id = $1 AND recording_id = $2`, [runId, recordingId]);
    return result.rows[0] ? toRun(result.rows[0]) : null;
  }

  async resolveResource(tokenHashValue: string, logicalPath: string): Promise<ResolvedPlaybackResource | "expired" | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const runs = await client.query<RunRow>(`SELECT * FROM playback_runs WHERE token_hash = $1 FOR UPDATE`, [tokenHashValue]);
      const run = runs.rows[0];
      if (!run) { await client.query("COMMIT"); return null; }
      if (run.state === "completed" || run.state === "failed" || run.state === "expired" || run.expires_at <= new Date()) {
        if (run.state === "created" || run.state === "active") await client.query(`UPDATE playback_runs SET state = 'expired' WHERE id = $1`, [run.id]);
        await client.query("COMMIT");
        return "expired";
      }
      const resource = await client.query<ResourceRow>(
        `SELECT playback_runs.id, playback_runs.state, playback_runs.expires_at, playback_runs.max_duration_seconds, playback_runs.network_profile,
                recorded_resources.storage_key, recorded_resources.content_type, recorded_resources.size_bytes, recorded_resources.kind, recorded_resources.metadata
           FROM playback_runs JOIN recorded_resources ON recorded_resources.recording_id = playback_runs.recording_id
          WHERE playback_runs.id = $1 AND recorded_resources.logical_path = $2`, [run.id, logicalPath]);
      if (!resource.rows[0]) { await client.query("COMMIT"); return null; }
      const row = resource.rows[0];
      if (row.kind === "video-segment" && run.first_media_request_at === null) {
        await client.query(`UPDATE playback_runs SET state = 'active', first_media_request_at = now(), expires_at = now() + (max_duration_seconds * interval '1 second') WHERE id = $1`, [run.id]);
      }
      await client.query("COMMIT");
      return { runId: row.id, state: row.kind === "video-segment" && row.state === "created" ? "active" : row.state, storageKey: row.storage_key, ...(row.content_type ? { contentType: row.content_type } : {}), sizeBytes: Number(row.size_bytes), resourceKind: row.kind, profile: row.network_profile ?? baselineNetworkProfile, metadata: row.metadata };
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
  }

  async recordDelivery(input: Omit<DeliveryRequest, "id" | "completedAt"> & { runId: string }): Promise<void> {
    await this.pool.query(`INSERT INTO delivery_requests (playback_run_id, logical_path, resource_kind, target_id, media_sequence, stage_index, bandwidth_kbps, latency_ms, bytes_sent, status_code, started_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [input.runId, input.logicalPath, input.resourceKind, input.targetId ?? null, input.mediaSequence ?? null, input.stageIndex, input.bandwidthKbps, input.latencyMs, input.bytesSent, input.statusCode, input.startedAt]);
  }

  async listDeliveries(recordingId: string, runId: string, limit: number): Promise<DeliveryRequest[]> {
    const result = await this.pool.query<DeliveryRow>(`SELECT delivery_requests.*, recorded_resources.metadata FROM delivery_requests JOIN playback_runs ON playback_runs.id = delivery_requests.playback_run_id JOIN recorded_resources ON recorded_resources.recording_id = playback_runs.recording_id AND recorded_resources.logical_path = delivery_requests.logical_path WHERE playback_runs.recording_id=$1 AND delivery_requests.playback_run_id=$2 ORDER BY delivery_requests.id DESC LIMIT $3`, [recordingId, runId, limit]);
    return result.rows.map((row) => ({ id: row.id, logicalPath: row.logical_path, resourceKind: row.resource_kind, ...(row.target_id ? { targetId: row.target_id } : {}), ...(row.media_sequence === null ? {} : { mediaSequence: row.media_sequence }), ...(typeof row.metadata.bandwidth === "number" ? { variantBandwidth: row.metadata.bandwidth } : {}), ...(typeof row.metadata.resolution === "string" ? { variantResolution: row.metadata.resolution } : {}), stageIndex: row.stage_index, bandwidthKbps: row.bandwidth_kbps, latencyMs: row.latency_ms, bytesSent: Number(row.bytes_sent), statusCode: row.status_code, startedAt: row.started_at.toISOString(), completedAt: row.completed_at.toISOString() }));
  }
}

export function tokenHash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function toRun(row: RunRow): PlaybackRun { return { id: row.id, recordingId: row.recording_id, state: row.state, maxDurationSeconds: row.max_duration_seconds, profile: row.network_profile ?? baselineNetworkProfile, createdAt: row.created_at.toISOString(), expiresAt: row.expires_at.toISOString(), ...(row.first_media_request_at ? { firstMediaRequestAt: row.first_media_request_at.toISOString() } : {}), ...(row.completed_at ? { completedAt: row.completed_at.toISOString() } : {}), ...(row.error_code ? { errorCode: row.error_code } : {}), ...(row.error_message ? { errorMessage: row.error_message } : {}) }; }
