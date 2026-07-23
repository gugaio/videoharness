import type pg from "pg";
import { InvestigationReportContentSchema } from "../../contracts/investigation.js";
import type { EvidenceBundleV2, EvidenceBundleV3, PlaybackSessionEvidence } from "../domain/evidence.js";
import type { InvestigationReportContent } from "../domain/investigation-report.js";
import type { InvestigationAI } from "../ports/investigation-ai.js";
import type { AiInvestigationResult } from "../ports/investigation-ai.js";

type Claimed = { id: string; investigation_id: string; source_url: string; problem_description: string | null; payload: { playbackSessionId?: string } };
type TelemetryRow = { id: string; metadata: { telemetry?: Omit<PlaybackSessionEvidence, "id"> } };

/** Runs a bounded report revision. The initial report remains published if this job fails. */
export async function runNextPlaybackReview(input: { pool: pg.Pool; workerId: string; leaseMs: number; ai?: InvestigationAI }): Promise<boolean> {
  const client = await input.pool.connect();
  let job: Claimed | undefined;
  try {
    await client.query("BEGIN");
    const claimed = await client.query<Claimed>(
      `WITH candidate AS (SELECT id FROM jobs WHERE kind = 'playback_synthesis' AND attempts < max_attempts AND (status = 'pending' OR (status = 'running' AND locked_until < now())) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
       UPDATE jobs j SET status='running', attempts=attempts+1, locked_by=$1, locked_until=now()+($2 * interval '1 millisecond'), heartbeat_at=now() FROM candidate WHERE j.id=candidate.id
       RETURNING j.id, j.investigation_id, j.payload, (SELECT source_url FROM investigations i WHERE i.id=j.investigation_id) source_url, (SELECT problem_description FROM investigations i WHERE i.id=j.investigation_id) problem_description`, [input.workerId, input.leaseMs]);
    job = claimed.rows[0];
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
  if (!job) return false;
  try {
    const reportResult = await input.pool.query<{ content: unknown }>(`SELECT content FROM reports WHERE investigation_id = $1`, [job.investigation_id]);
    const report = InvestigationReportContentSchema.parse(reportResult.rows[0]?.content) as InvestigationReportContent;
    if (report.placeholder || report.evidence.schemaVersion === 1) throw new Error("Playback review requires deterministic media evidence");
    const telemetry = await input.pool.query<TelemetryRow>(`SELECT a.id, a.metadata FROM playback_sessions p JOIN artifacts a ON a.id=p.artifact_id WHERE p.id=$1 AND p.investigation_id=$2 AND p.status='completed'`, [job.payload.playbackSessionId, job.investigation_id]);
    const row = telemetry.rows[0];
    if (!row?.metadata.telemetry) throw new Error("Playback telemetry artifact is unavailable");
    const evidence: EvidenceBundleV3 = { ...report.evidence as EvidenceBundleV2, schemaVersion: 3, playbackSessions: [{ id: row.id, ...row.metadata.telemetry }] };
    const existingAi = ("ai" in report ? report.ai : undefined) as AiInvestigationResult | undefined;
    const aiResult = input.ai ? await input.ai.investigate({ investigationId: job.investigation_id, ...(job.problem_description ? { problemDescription: job.problem_description } : {}), evidence }) : existingAi;
    const session = evidence.playbackSessions[0]!;
    const next: InvestigationReportContent = {
      ...report,
      summary: `${report.summary} Browser playback telemetry was added from a ${Math.round(session.playedMs / 1000)}s validation run.`,
      findings: [...report.findings.filter((finding) => finding.title !== "Browser playback validation"), {
        title: "Browser playback validation", status: session.errors.length || session.stalls ? "limitation" : "observed",
        explanation: `${session.engine} played ${Math.round(session.playedMs / 1000)}s; ${session.stalls} stall(s), ${session.fragmentsLoaded} fragment(s), ${session.errors.length} playback error(s).`,
      }],
      confidence: { level: "limited", explanation: aiResult?.likelyCause ? `AI synthesis after browser playback: ${aiResult.likelyCause}` : report.confidence.explanation },
      evidence, ...(aiResult ? { ai: aiResult } : {}), generatedBy: "deterministic-playback-v1",
    };
    await input.pool.query("BEGIN");
    await input.pool.query(`UPDATE reports SET content=$2::jsonb, updated_at=now() WHERE investigation_id=$1`, [job.investigation_id, JSON.stringify(next)]);
    await input.pool.query(`UPDATE jobs SET status='completed', completed_at=now(), locked_by=NULL, locked_until=NULL WHERE id=$1 AND locked_by=$2`, [job.id, input.workerId]);
    await input.pool.query(`INSERT INTO investigation_events (investigation_id,type,actor,message,payload) VALUES ($1,'investigation.report_updated','Investigator','Browser playback evidence has been incorporated into the report.',$2::jsonb)`, [job.investigation_id, JSON.stringify({ state: "completed", revision: "playback", playbackSessionId: job.payload.playbackSessionId })]);
    await input.pool.query("COMMIT");
  } catch (error) {
    await input.pool.query(`UPDATE jobs SET status='failed', completed_at=now(), locked_by=NULL, locked_until=NULL, error_code='PLAYBACK_REVIEW_FAILED', error_message=$3 WHERE id=$1 AND locked_by=$2`, [job.id, input.workerId, error instanceof Error ? error.message.slice(0, 300) : "Unknown playback review failure"]);
  }
  return true;
}
