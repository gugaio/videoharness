import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { PlaybackSessionEvidence } from "../domain/evidence.js";

export type PlaybackSession = {
  id: string;
  investigationId: string;
  status: "running" | "completed" | "failed" | "expired";
  requestedDurationMs: number;
  engine?: "hls.js" | "native-hls";
  artifactId?: string;
  createdAt: string;
  finishedAt?: string;
  errorCode?: string;
  errorMessage?: string;
};

type Row = { id: string; investigation_id: string; status: PlaybackSession["status"]; requested_duration_ms: number; engine: PlaybackSession["engine"] | null; artifact_id: string | null; created_at: Date; finished_at: Date | null; error_code: string | null; error_message: string | null };
const toSession = (row: Row): PlaybackSession => ({ id: row.id, investigationId: row.investigation_id, status: row.status, requestedDurationMs: row.requested_duration_ms, ...(row.engine ? { engine: row.engine } : {}), ...(row.artifact_id ? { artifactId: row.artifact_id } : {}), createdAt: row.created_at.toISOString(), ...(row.finished_at ? { finishedAt: row.finished_at.toISOString() } : {}), ...(row.error_code ? { errorCode: row.error_code } : {}), ...(row.error_message ? { errorMessage: row.error_message } : {}) });

export class PostgresPlaybackSessions {
  constructor(private readonly pool: pg.Pool) {}

  async create(investigationId: string, requestedDurationMs: number): Promise<PlaybackSession> {
    const result = await this.pool.query<Row>(
      `INSERT INTO playback_sessions (id, investigation_id, status, requested_duration_ms) VALUES ($1, $2, 'running', $3) RETURNING *`,
      [randomUUID(), investigationId, requestedDurationMs],
    );
    return toSession(result.rows[0]!);
  }
  async latest(investigationId: string): Promise<PlaybackSession | null> {
    const result = await this.pool.query<Row>(`SELECT * FROM playback_sessions WHERE investigation_id = $1 ORDER BY created_at DESC LIMIT 1`, [investigationId]);
    return result.rows[0] ? toSession(result.rows[0]) : null;
  }
  async complete(investigationId: string, sessionId: string, telemetry: Omit<PlaybackSessionEvidence, "id">): Promise<PlaybackSession | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const artifactId = randomUUID();
      await client.query(
        `INSERT INTO artifacts (id, investigation_id, logical_key, kind, storage_key, content_type, size_bytes, metadata)
         VALUES ($1, $2, $3, 'playback-telemetry', $3, 'application/json', $4, $5::jsonb)`,
        [artifactId, investigationId, `playback/${sessionId}`, Buffer.byteLength(JSON.stringify(telemetry)), JSON.stringify({ telemetry })],
      );
      const updated = await client.query<Row>(
        `UPDATE playback_sessions SET status = 'completed', engine = $3, artifact_id = $4, finished_at = now()
          WHERE id = $1 AND investigation_id = $2 AND status = 'running' RETURNING *`, [sessionId, investigationId, telemetry.engine, artifactId],
      );
      const row = updated.rows[0];
      if (!row) { await client.query("ROLLBACK"); return null; }
      await client.query(`INSERT INTO jobs (id, investigation_id, kind, status, payload, max_attempts) VALUES ($1, $2, 'playback_synthesis', 'pending', $3::jsonb, 2)`, [randomUUID(), investigationId, JSON.stringify({ playbackSessionId: sessionId })]);
      await client.query(`INSERT INTO investigation_events (investigation_id, type, actor, message, payload) VALUES ($1, 'investigation.playback_completed', 'Browser Playback', 'Browser playback telemetry was recorded; the report is being revised.', $2::jsonb)`, [investigationId, JSON.stringify({ sessionId, state: "completed" })]);
      await client.query("COMMIT");
      return toSession(updated.rows[0]!);
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
  }
  async fail(investigationId: string, sessionId: string, code: string, message: string): Promise<PlaybackSession | null> {
    const result = await this.pool.query<Row>(`UPDATE playback_sessions SET status = 'failed', error_code = $3, error_message = $4, finished_at = now() WHERE id = $1 AND investigation_id = $2 AND status = 'running' RETURNING *`, [sessionId, investigationId, code, message]);
    return result.rows[0] ? toSession(result.rows[0]) : null;
  }
}
