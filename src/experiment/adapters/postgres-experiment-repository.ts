import { randomUUID } from "node:crypto";
import type pg from "pg";
import { CloneExecutionPlanSchema, CloneSpecSchema, CloneVerificationReportSchema } from "../../contracts/experiment.js";
import type { CloneExecutionPlan, CloneSpec, CloneVerificationReport } from "../domain/clone-spec.js";
import type {
  Experiment,
  ExperimentClone,
  ExperimentDetail,
  ExperimentEvaluation,
  ExperimentIteration,
  Hypothesis,
  HypothesisEvaluation,
  TestEnvironment,
  TestRequest,
  TestResult,
} from "../domain/experiment.js";
import type {
  CreateExperimentRecord,
  ExperimentRepository,
  PreparedExperimentClone,
  SubmitTestResultRecord,
} from "../ports/experiment-repository.js";

type ExperimentRow = {
  id: string; investigation_id: string; goal: string; status: Experiment["status"]; created_by: string;
  target_environment_id: string | null; active_test_request_id: string | null; created_at: Date; updated_at: Date;
};
type EnvironmentRow = {
  id: string; name: string; platform: string | null; platform_version: string | null; manufacturer: string | null;
  model: string | null; firmware_version: string | null; application_name: string | null; application_version: string | null;
  player_engine: string | null; network_notes: string | null; created_at: Date; updated_at: Date;
};
type HypothesisRow = {
  id: string; experiment_id: string; statement: string; rationale: string; evidence_for: unknown; evidence_against: unknown;
  status: Hypothesis["status"]; created_at: Date; updated_at: Date;
};
type IterationRow = {
  id: string; experiment_id: string; iteration_number: number; rationale: string; clone_specs: unknown;
  status: ExperimentIteration["status"]; created_at: Date; updated_at: Date;
};
type CloneRow = {
  id: string; experiment_id: string; iteration_id: string; recording_id: string; short_label: string; is_control: boolean;
  state: ExperimentClone["state"]; clone_spec: unknown; clone_spec_hash: string; execution_plan: unknown;
  provenance: unknown; verification: unknown | null; error_code: string | null; error_message: string | null;
  created_at: Date; updated_at: Date; completed_at: Date | null;
};
type RequestRow = {
  id: string; experiment_id: string; iteration_id: string; clone_id: string; short_label: string; test_url: string;
  instructions: string; hypothesis_ids: unknown; environment_id: string | null; status: TestRequest["status"];
  expires_at: Date | null; created_at: Date; updated_at: Date;
};
type ResultRow = {
  id: string; test_request_id: string; outcome: TestResult["outcome"]; failure_stage: TestResult["failureStage"] | null;
  error_code: string | null; time_to_first_frame_ms: number | null; stall_observed: boolean | null; audio_observed: boolean | null;
  video_observed: boolean | null; av_sync_issue: boolean | null; seek_issue: boolean | null; notes: string | null;
  evidence_artifact_ids: unknown; reported_by: string; reported_via: TestResult["reportedVia"];
  test_environment_id: string | null; occurred_at: Date; created_at: Date; updated_at: Date;
};
type EvaluationRow = {
  id: string; experiment_id: string; iteration_id: string; status: ExperimentEvaluation["status"];
  confidence: ExperimentEvaluation["confidence"]; summary: string; hypothesis_updates: unknown; evidence_bundle: unknown;
  analysis: unknown | null; proposed_next_plan: unknown | null; created_at: Date;
};
type EvaluationJobRow = {
  id: string; status: NonNullable<ExperimentDetail["evaluationJob"]>["status"]; attempts: number; max_attempts: number;
  error_code: string | null; error_message: string | null; created_at: Date; started_at: Date | null; completed_at: Date | null;
};

export class PostgresExperimentRepository implements ExperimentRepository {
  constructor(private readonly pool: pg.Pool) {}

  async createExperiment(input: CreateExperimentRecord): Promise<ExperimentDetail> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO experiments (id, investigation_id, goal, status, created_by, target_environment_id)
         VALUES ($1,$2,$3,'DRAFT',$4,$5)`,
        [input.id, input.investigationId, input.goal, input.createdBy, input.targetEnvironmentId ?? null],
      );
      for (const hypothesis of input.hypotheses) {
        await client.query(
          `INSERT INTO hypotheses (id, experiment_id, statement, rationale, evidence_for, evidence_against, status)
           VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,'OPEN')`,
          [hypothesis.id, input.id, hypothesis.statement, hypothesis.rationale, JSON.stringify(hypothesis.evidenceFor), JSON.stringify(hypothesis.evidenceAgainst)],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }
    return (await this.findById(input.id))!;
  }

  async listByInvestigation(investigationId: string): Promise<Experiment[]> {
    const result = await this.pool.query<ExperimentRow>(
      `SELECT id, investigation_id, goal, status, created_by, target_environment_id, active_test_request_id, created_at, updated_at
         FROM experiments WHERE investigation_id = $1 ORDER BY created_at DESC`, [investigationId]);
    return result.rows.map(toExperiment);
  }

  async findById(id: string): Promise<ExperimentDetail | null> {
    const experimentResult = await this.pool.query<ExperimentRow>(
      `SELECT id, investigation_id, goal, status, created_by, target_environment_id, active_test_request_id, created_at, updated_at FROM experiments WHERE id = $1`, [id]);
    const row = experimentResult.rows[0];
    if (!row) return null;
    const [hypotheses, iterations, clones, requests, results, evaluations, environments, evaluationJobs] = await Promise.all([
      this.pool.query<HypothesisRow>(`SELECT * FROM hypotheses WHERE experiment_id = $1 ORDER BY created_at`, [id]),
      this.pool.query<IterationRow>(`SELECT * FROM experiment_iterations WHERE experiment_id = $1 ORDER BY iteration_number`, [id]),
      this.pool.query<CloneRow>(`SELECT * FROM experiment_clones WHERE experiment_id = $1 ORDER BY created_at`, [id]),
      this.pool.query<RequestRow>(`SELECT * FROM test_requests WHERE experiment_id = $1 ORDER BY created_at`, [id]),
      this.pool.query<ResultRow>(`SELECT result.* FROM test_results result JOIN test_requests request ON request.id = result.test_request_id WHERE request.experiment_id = $1`, [id]),
      this.pool.query<EvaluationRow>(`SELECT * FROM experiment_evaluations WHERE experiment_id = $1 ORDER BY created_at`, [id]),
      row.target_environment_id
        ? this.pool.query<EnvironmentRow>(`SELECT * FROM test_environments WHERE id = $1`, [row.target_environment_id])
        : Promise.resolve({ rows: [] as EnvironmentRow[] }),
      this.pool.query<EvaluationJobRow>(`SELECT id, status, attempts, max_attempts, error_code, error_message, created_at, started_at, completed_at FROM experiment_evaluation_jobs WHERE experiment_id = $1 ORDER BY created_at DESC LIMIT 1`, [id]),
    ]);
    const resultByRequest = new Map(results.rows.map((entry) => [entry.test_request_id, toTestResult(entry)]));
    return {
      ...toExperiment(row),
      ...(environments.rows[0] ? { targetEnvironment: toEnvironment(environments.rows[0]) } : {}),
      hypotheses: hypotheses.rows.map(toHypothesis),
      iterations: iterations.rows.map(toIteration),
      clones: clones.rows.map(toClone),
      testRequests: requests.rows.map((entry) => toTestRequest(entry, resultByRequest.get(entry.id))),
      evaluations: evaluations.rows.map(toEvaluation),
      ...(evaluationJobs.rows[0] ? { evaluationJob: toEvaluationJob(evaluationJobs.rows[0]) } : {}),
    };
  }

  async createIteration(input: { id: string; experimentId: string; rationale: string; cloneSpecs: CloneSpec[] }): Promise<ExperimentIteration | "not_found" | "invalid_state"> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const experiment = await client.query<{ status: Experiment["status"] }>(`SELECT status FROM experiments WHERE id = $1 FOR UPDATE`, [input.experimentId]);
      if (!experiment.rows[0]) { await client.query("ROLLBACK"); return "not_found"; }
      if (experiment.rows[0].status !== "DRAFT" && experiment.rows[0].status !== "FOLLOWUP_REQUIRED") { await client.query("ROLLBACK"); return "invalid_state"; }
      const number = await client.query<{ next: number }>(`SELECT COALESCE(MAX(iteration_number), 0) + 1 AS next FROM experiment_iterations WHERE experiment_id = $1`, [input.experimentId]);
      const created = await client.query<IterationRow>(
        `INSERT INTO experiment_iterations (id, experiment_id, iteration_number, rationale, clone_specs, status)
         VALUES ($1,$2,$3,$4,$5::jsonb,'PLANNED') RETURNING *`,
        [input.id, input.experimentId, number.rows[0]!.next, input.rationale, JSON.stringify(input.cloneSpecs)],
      );
      await client.query(`UPDATE experiments SET status = 'PLANNED', updated_at = now() WHERE id = $1`, [input.experimentId]);
      await client.query("COMMIT");
      return toIteration(created.rows[0]!);
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
  }

  async queueClones(input: { experimentId: string; iterationId: string; clones: PreparedExperimentClone[] }): Promise<"queued" | "not_found" | "invalid_state"> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<{ experiment_status: Experiment["status"]; iteration_status: ExperimentIteration["status"] }>(
        `SELECT experiment.status AS experiment_status, iteration.status AS iteration_status
           FROM experiments experiment JOIN experiment_iterations iteration ON iteration.experiment_id = experiment.id
          WHERE experiment.id = $1 AND iteration.id = $2 FOR UPDATE OF experiment, iteration`, [input.experimentId, input.iterationId]);
      if (!locked.rows[0]) { await client.query("ROLLBACK"); return "not_found"; }
      if (locked.rows[0].experiment_status !== "PLANNED" || locked.rows[0].iteration_status !== "PLANNED") { await client.query("ROLLBACK"); return "invalid_state"; }
      for (const clone of input.clones) await insertPreparedClone(client, input.experimentId, input.iterationId, clone);
      await client.query(`UPDATE experiment_iterations SET status = 'BUILDING_CLONES', updated_at = now() WHERE id = $1`, [input.iterationId]);
      await client.query(`UPDATE experiments SET status = 'BUILDING_CLONES', updated_at = now() WHERE id = $1`, [input.experimentId]);
      await client.query("COMMIT");
      return "queued";
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
  }

  async findClone(id: string): Promise<ExperimentClone | null> {
    const result = await this.pool.query<CloneRow>(`SELECT * FROM experiment_clones WHERE id = $1`, [id]);
    return result.rows[0] ? toClone(result.rows[0]) : null;
  }

  async findCloneByRecordingId(recordingId: string): Promise<ExperimentClone | null> {
    const result = await this.pool.query<CloneRow>(`SELECT * FROM experiment_clones WHERE recording_id = $1`, [recordingId]);
    return result.rows[0] ? toClone(result.rows[0]) : null;
  }

  async markCloneStarted(recordingId: string, jobId: string): Promise<void> {
    await this.pool.query(
      `UPDATE experiment_clones SET state = 'BUILDING', updated_at = now(),
              provenance = provenance || jsonb_build_object('jobId', $2::text, 'startedAt', now()::text)
        WHERE recording_id = $1 AND state = 'QUEUED'`, [recordingId, jobId]);
  }

  async markCloneVerifying(recordingId: string): Promise<void> {
    await this.pool.query(
      `UPDATE experiment_clones
          SET state = 'VERIFYING', updated_at = now()
        WHERE recording_id = $1 AND state IN ('QUEUED','BUILDING')`,
      [recordingId],
    );
  }

  async completeClone(input: { recordingId: string; verification: CloneVerificationReport; provenance: Record<string, unknown> }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const updated = await client.query<{ iteration_id: string; experiment_id: string }>(
        `UPDATE experiment_clones
            SET state = $2, verification = $3::jsonb, provenance = provenance || $4::jsonb,
                error_code = CASE WHEN $2 = 'FAILED' THEN 'CLONE_VERIFICATION_FAILED' ELSE NULL END,
                error_message = CASE WHEN $2 = 'FAILED' THEN $5 ELSE NULL END,
                updated_at = now(), completed_at = now()
          WHERE recording_id = $1 AND state IN ('BUILDING','VERIFYING')
          RETURNING iteration_id, experiment_id`,
        [input.recordingId, input.verification.status === "PASSED" ? "READY" : "FAILED", JSON.stringify(input.verification), JSON.stringify(input.provenance), input.verification.errors.join(" ").slice(0, 500)],
      );
      if (updated.rows[0]) await refreshIterationState(client, updated.rows[0].experiment_id, updated.rows[0].iteration_id);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
  }

  async failClone(input: { recordingId: string; errorCode: string; errorMessage: string; provenance: Record<string, unknown> }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const updated = await client.query<{ iteration_id: string; experiment_id: string }>(
        `UPDATE experiment_clones SET state = 'FAILED', error_code = $2, error_message = $3,
          provenance = provenance || $4::jsonb, updated_at = now(), completed_at = now()
          WHERE recording_id = $1 AND state IN ('QUEUED','BUILDING','VERIFYING') RETURNING iteration_id, experiment_id`,
        [input.recordingId, input.errorCode, input.errorMessage.slice(0, 500), JSON.stringify(input.provenance)],
      );
      if (updated.rows[0]) await refreshIterationState(client, updated.rows[0].experiment_id, updated.rows[0].iteration_id);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
  }

  async findTestRequest(id: string): Promise<TestRequest | null> {
    const [request, result] = await Promise.all([
      this.pool.query<RequestRow>(`SELECT * FROM test_requests WHERE id = $1`, [id]),
      this.pool.query<ResultRow>(`SELECT * FROM test_results WHERE test_request_id = $1`, [id]),
    ]);
    return request.rows[0] ? toTestRequest(request.rows[0], result.rows[0] ? toTestResult(result.rows[0]) : undefined) : null;
  }

  async activateTestRequest(id: string): Promise<TestRequest | "not_found" | "not_ready"> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query<{ experiment_id: string; clone_state: ExperimentClone["state"]; recording_state: string }>(
        `SELECT request.experiment_id, clone.state AS clone_state, recording.state AS recording_state
           FROM test_requests request
           JOIN experiment_clones clone ON clone.id = request.clone_id
           JOIN recordings recording ON recording.id = clone.recording_id
          WHERE request.id = $1 FOR UPDATE OF request`, [id]);
      const row = selected.rows[0];
      if (!row) { await client.query("ROLLBACK"); return "not_found"; }
      if (row.clone_state !== "READY" || row.recording_state !== "ready") { await client.query("ROLLBACK"); return "not_ready"; }
      await client.query(`UPDATE experiments SET active_test_request_id = $2, updated_at = now() WHERE id = $1`, [row.experiment_id, id]);
      await client.query("COMMIT");
      return (await this.findTestRequest(id))!;
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
  }

  async resolveActiveStream(experimentId: string): Promise<import("../ports/experiment-repository.js").ActiveExperimentStream | null> {
    const result = await this.pool.query<{
      test_request_id: string; clone_id: string; recording_id: string; protocol: "hls" | "dash";
    }>(
      `SELECT request.id AS test_request_id, clone.id AS clone_id, clone.recording_id, recording.protocol
         FROM experiments experiment
         JOIN test_requests request ON request.id = experiment.active_test_request_id AND request.experiment_id = experiment.id
         JOIN experiment_clones clone ON clone.id = request.clone_id AND clone.state = 'READY'
         JOIN recordings recording ON recording.id = clone.recording_id AND recording.state = 'ready'
        WHERE experiment.id = $1`, [experimentId]);
    const row = result.rows[0];
    return row ? { experimentId, testRequestId: row.test_request_id, cloneId: row.clone_id, recordingId: row.recording_id, protocol: row.protocol } : null;
  }

  async listTestRequests(experimentId: string): Promise<TestRequest[]> {
    const [requests, results] = await Promise.all([
      this.pool.query<RequestRow>(`SELECT * FROM test_requests WHERE experiment_id = $1 ORDER BY created_at`, [experimentId]),
      this.pool.query<ResultRow>(`SELECT result.* FROM test_results result JOIN test_requests request ON request.id = result.test_request_id WHERE request.experiment_id = $1`, [experimentId]),
    ]);
    const byRequest = new Map(results.rows.map((entry) => [entry.test_request_id, toTestResult(entry)]));
    return requests.rows.map((entry) => toTestRequest(entry, byRequest.get(entry.id)));
  }

  async submitTestResult(input: SubmitTestResultRecord): Promise<TestResult | "not_found"> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const request = await client.query<{ experiment_id: string; iteration_id: string }>(`SELECT experiment_id, iteration_id FROM test_requests WHERE id = $1 FOR UPDATE`, [input.testRequestId]);
      if (!request.rows[0]) { await client.query("ROLLBACK"); return "not_found"; }
      const result = await client.query<ResultRow>(
        `INSERT INTO test_results (id, test_request_id, outcome, failure_stage, error_code, time_to_first_frame_ms,
          stall_observed, audio_observed, video_observed, av_sync_issue, seek_issue, notes, evidence_artifact_ids,
          reported_by, reported_via, test_environment_id, occurred_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16,$17)
         ON CONFLICT (test_request_id) DO UPDATE SET
          outcome = EXCLUDED.outcome, failure_stage = EXCLUDED.failure_stage, error_code = EXCLUDED.error_code,
          time_to_first_frame_ms = EXCLUDED.time_to_first_frame_ms, stall_observed = EXCLUDED.stall_observed,
          audio_observed = EXCLUDED.audio_observed, video_observed = EXCLUDED.video_observed,
          av_sync_issue = EXCLUDED.av_sync_issue, seek_issue = EXCLUDED.seek_issue, notes = EXCLUDED.notes,
          evidence_artifact_ids = EXCLUDED.evidence_artifact_ids, reported_by = EXCLUDED.reported_by,
          reported_via = EXCLUDED.reported_via, test_environment_id = EXCLUDED.test_environment_id,
          occurred_at = EXCLUDED.occurred_at, updated_at = now()
         RETURNING *`,
        [input.id, input.testRequestId, input.outcome, input.failureStage ?? null, input.errorCode ?? null, input.timeToFirstFrameMs ?? null,
          input.stallObserved ?? null, input.audioObserved ?? null, input.videoObserved ?? null, input.avSyncIssue ?? null, input.seekIssue ?? null,
          input.notes ?? null, JSON.stringify(input.evidenceArtifactIds), input.reportedBy, input.reportedVia,
          input.testEnvironmentId ?? null, input.occurredAt],
      );
      await client.query(`UPDATE test_requests SET status = 'COMPLETED', updated_at = now() WHERE id = $1`, [input.testRequestId]);
      const remaining = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM test_requests WHERE iteration_id = $1 AND status = 'PENDING'`, [request.rows[0].iteration_id]);
      if (Number(remaining.rows[0]?.count ?? 0) === 0) {
        await client.query(`UPDATE experiment_iterations SET status = 'EVALUATING', updated_at = now() WHERE id = $1`, [request.rows[0].iteration_id]);
        await client.query(`UPDATE experiments SET status = 'EVALUATING', updated_at = now() WHERE id = $1 AND status = 'AWAITING_TESTS'`, [request.rows[0].experiment_id]);
      }
      await client.query("COMMIT");
      return toTestResult(result.rows[0]!);
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
  }

  async saveEvaluation(evaluation: Omit<ExperimentEvaluation, "createdAt">): Promise<ExperimentEvaluation | "invalid_state"> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<{ status: Experiment["status"] }>(`SELECT status FROM experiments WHERE id = $1 FOR UPDATE`, [evaluation.experimentId]);
      if (!locked.rows[0] || (locked.rows[0].status !== "EVALUATING" && locked.rows[0].status !== "AWAITING_TESTS")) { await client.query("ROLLBACK"); return "invalid_state"; }
      const inserted = await client.query<EvaluationRow>(
        `INSERT INTO experiment_evaluations (id, experiment_id, iteration_id, status, confidence, summary, hypothesis_updates, evidence_bundle, analysis, proposed_next_plan)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb) RETURNING *`,
        [evaluation.id, evaluation.experimentId, evaluation.iterationId, evaluation.status, evaluation.confidence, evaluation.summary,
          JSON.stringify(evaluation.hypothesisUpdates), JSON.stringify(evaluation.evidenceBundle),
          evaluation.analysis ? JSON.stringify(evaluation.analysis) : null,
          evaluation.proposedNextExperimentPlan ? JSON.stringify(evaluation.proposedNextExperimentPlan) : null],
      );
      for (const update of evaluation.hypothesisUpdates) {
        await client.query(`UPDATE hypotheses SET status = $2, evidence_for = $3::jsonb, evidence_against = $4::jsonb, updated_at = now() WHERE id = $1 AND experiment_id = $5`,
          [update.hypothesisId, update.status, JSON.stringify(update.evidenceFor), JSON.stringify(update.evidenceAgainst), evaluation.experimentId]);
      }
      const pending = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM test_requests WHERE iteration_id = $1 AND status = 'PENDING'`, [evaluation.iterationId]);
      const hasPending = Number(pending.rows[0]?.count ?? 0) > 0;
      if (evaluation.status === "MORE_TESTS_REQUIRED" && hasPending) {
        await client.query(`UPDATE experiment_iterations SET status = 'AWAITING_TESTS', updated_at = now() WHERE id = $1`, [evaluation.iterationId]);
        await client.query(`UPDATE experiments SET status = 'AWAITING_TESTS', updated_at = now() WHERE id = $1`, [evaluation.experimentId]);
      } else {
        await client.query(`UPDATE experiment_iterations SET status = 'COMPLETED', updated_at = now() WHERE id = $1`, [evaluation.iterationId]);
        await client.query(`UPDATE experiments SET status = $2, updated_at = now() WHERE id = $1`,
          [evaluation.experimentId, evaluation.status === "CONCLUDED" ? "CONCLUDED" : "FOLLOWUP_REQUIRED"]);
      }
      await client.query("COMMIT");
      return toEvaluation(inserted.rows[0]!);
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
  }

  async createEnvironment(input: Omit<TestEnvironment, "createdAt" | "updatedAt">): Promise<TestEnvironment> {
    const result = await this.pool.query<EnvironmentRow>(
      `INSERT INTO test_environments (id, name, platform, platform_version, manufacturer, model, firmware_version,
        application_name, application_version, player_engine, network_notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [input.id, input.name, input.platform ?? null, input.platformVersion ?? null, input.manufacturer ?? null,
        input.model ?? null, input.firmwareVersion ?? null, input.applicationName ?? null, input.applicationVersion ?? null,
        input.playerEngine ?? null, input.networkNotes ?? null],
    );
    return toEnvironment(result.rows[0]!);
  }

  async listEnvironments(): Promise<TestEnvironment[]> {
    const result = await this.pool.query<EnvironmentRow>(`SELECT * FROM test_environments ORDER BY name, created_at`);
    return result.rows.map(toEnvironment);
  }
}

async function insertPreparedClone(client: pg.PoolClient, experimentId: string, iterationId: string, clone: PreparedExperimentClone): Promise<void> {
  await client.query(
    `INSERT INTO recordings (id, source_url, protocol, state, requested_duration_seconds, requested_start_seconds,
      idempotency_key, request_signature, clone_spec, clone_plan)
     VALUES ($1,$2,$3,'queued',$4,0,$5,$6,$7::jsonb,$8::jsonb)`,
    [clone.recordingId, clone.sourceUrl, clone.protocol, clone.durationSeconds, `experiment-clone:${clone.id}`, clone.specHash, JSON.stringify(clone.spec), JSON.stringify(clone.plan)],
  );
  await client.query(`INSERT INTO recording_jobs (id, recording_id, status) VALUES ($1,$2,'pending')`, [clone.jobId, clone.recordingId]);
  await client.query(
    `INSERT INTO recording_events (recording_id, type, actor, message, payload)
     VALUES ($1,'recording.created','experiment','Experimental clone queued.',$2::jsonb)`,
    [clone.recordingId, JSON.stringify({ state: "queued", experimentId, iterationId, cloneId: clone.id })],
  );
  await client.query(
    `INSERT INTO experiment_clones (id, experiment_id, iteration_id, recording_id, short_label, is_control,
      state, clone_spec, clone_spec_hash, execution_plan, provenance)
     VALUES ($1,$2,$3,$4,$5,$6,'QUEUED',$7::jsonb,$8,$9::jsonb,$10::jsonb)`,
    [clone.id, experimentId, iterationId, clone.recordingId, clone.shortLabel, clone.isControl,
      JSON.stringify(clone.spec), clone.specHash, JSON.stringify(clone.plan), JSON.stringify({
        cloneId: clone.id,
        sourceInvestigationId: clone.spec.source.investigationId,
        cloneSpecHash: clone.specHash,
        executionPlanVersion: clone.plan.version,
        sourceArtifactIds: clone.plan.sourceArtifactIds,
        mediaTools: { ffmpeg: "not-used", ffprobe: "not-used", materializer: `${clone.protocol}-vod-v1` },
        queuedAt: new Date().toISOString(),
      })],
  );
}

async function refreshIterationState(client: pg.PoolClient, experimentId: string, iterationId: string): Promise<void> {
  const counts = await client.query<{ total: string; terminal: string; ready: string }>(
    `SELECT count(*)::text AS total,
            count(*) FILTER (WHERE state IN ('READY','FAILED'))::text AS terminal,
            count(*) FILTER (WHERE state = 'READY')::text AS ready
       FROM experiment_clones WHERE iteration_id = $1`, [iterationId]);
  const count = counts.rows[0];
  if (!count || Number(count.total) === 0 || Number(count.total) !== Number(count.terminal)) return;
  if (Number(count.ready) === 0) {
    await client.query(`UPDATE experiment_iterations SET status = 'FAILED', updated_at = now() WHERE id = $1`, [iterationId]);
    await client.query(`UPDATE experiments SET status = 'FAILED', updated_at = now() WHERE id = $1`, [experimentId]);
    return;
  }
  const ready = await client.query<{
    clone_id: string; short_label: string; recording_id: string; clone_spec: unknown; protocol: "hls" | "dash"; target_environment_id: string | null;
  }>(
    `SELECT clone.id AS clone_id, clone.short_label, clone.recording_id, clone.clone_spec,
            recording.protocol, experiment.target_environment_id
       FROM experiment_clones clone
       JOIN recordings recording ON recording.id = clone.recording_id
       JOIN experiments experiment ON experiment.id = clone.experiment_id
      WHERE clone.iteration_id = $1 AND clone.state = 'READY'`, [iterationId]);
  for (const clone of ready.rows) {
    const spec = parseCloneSpec(clone.clone_spec);
    await client.query(
      `INSERT INTO test_requests (id, experiment_id, iteration_id, clone_id, short_label, test_url,
        instructions, hypothesis_ids, environment_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,'PENDING')
       ON CONFLICT (clone_id) DO NOTHING`,
      [randomUUID(), experimentId, iterationId, clone.clone_id, clone.short_label,
        `/streams/experiments/${experimentId}/${clone.protocol === "dash" ? "index.mpd" : "index.m3u8"}`,
        `${spec.reason.description} ${spec.reason.expectedDiscriminatingSignal}`.slice(0, 2_000),
        JSON.stringify(spec.reason.hypothesisIds), clone.target_environment_id],
    );
  }
  await client.query(`UPDATE experiment_iterations SET status = 'AWAITING_TESTS', updated_at = now() WHERE id = $1`, [iterationId]);
  await client.query(`UPDATE experiments SET status = 'AWAITING_TESTS', updated_at = now() WHERE id = $1`, [experimentId]);
}

function toExperiment(row: ExperimentRow): Experiment {
  return { id: row.id, investigationId: row.investigation_id, goal: row.goal, status: row.status, createdBy: row.created_by,
    ...(row.target_environment_id ? { targetEnvironmentId: row.target_environment_id } : {}),
    ...(row.active_test_request_id ? { activeTestRequestId: row.active_test_request_id } : {}),
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
}
function toEnvironment(row: EnvironmentRow): TestEnvironment {
  return { id: row.id, name: row.name, ...optional("platform", row.platform), ...optional("platformVersion", row.platform_version),
    ...optional("manufacturer", row.manufacturer), ...optional("model", row.model), ...optional("firmwareVersion", row.firmware_version),
    ...optional("applicationName", row.application_name), ...optional("applicationVersion", row.application_version),
    ...optional("playerEngine", row.player_engine), ...optional("networkNotes", row.network_notes),
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
}
function toHypothesis(row: HypothesisRow): Hypothesis {
  return { id: row.id, experimentId: row.experiment_id, statement: row.statement, rationale: row.rationale,
    evidenceFor: stringArray(row.evidence_for), evidenceAgainst: stringArray(row.evidence_against), status: row.status,
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
}
function toIteration(row: IterationRow): ExperimentIteration {
  const specs = Array.isArray(row.clone_specs) ? row.clone_specs.map(parseCloneSpec) : [];
  return { id: row.id, experimentId: row.experiment_id, iterationNumber: row.iteration_number, rationale: row.rationale,
    cloneSpecs: specs, status: row.status, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
}
function toClone(row: CloneRow): ExperimentClone {
  const verification = row.verification === null ? undefined : parseVerification(row.verification);
  return { id: row.id, experimentId: row.experiment_id, iterationId: row.iteration_id, recordingId: row.recording_id,
    shortLabel: row.short_label, isControl: row.is_control, state: row.state, spec: parseCloneSpec(row.clone_spec),
    specHash: row.clone_spec_hash, executionPlan: parseExecutionPlan(row.execution_plan), provenance: record(row.provenance),
    ...(verification ? { verification } : {}), ...optional("errorCode", row.error_code), ...optional("errorMessage", row.error_message),
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(), ...(row.completed_at ? { completedAt: row.completed_at.toISOString() } : {}) };
}
function toTestRequest(row: RequestRow, result?: TestResult): TestRequest {
  return { id: row.id, experimentId: row.experiment_id, iterationId: row.iteration_id, cloneId: row.clone_id,
    shortLabel: row.short_label, testUrl: row.test_url, instructions: row.instructions, hypothesisIds: stringArray(row.hypothesis_ids),
    ...optional("environmentId", row.environment_id), status: row.status, ...(row.expires_at ? { expiresAt: row.expires_at.toISOString() } : {}),
    ...(result ? { result } : {}), createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
}
function toTestResult(row: ResultRow): TestResult {
  return { id: row.id, testRequestId: row.test_request_id, outcome: row.outcome, ...optional("failureStage", row.failure_stage),
    ...optional("errorCode", row.error_code), ...optional("timeToFirstFrameMs", row.time_to_first_frame_ms),
    ...optional("stallObserved", row.stall_observed), ...optional("audioObserved", row.audio_observed), ...optional("videoObserved", row.video_observed),
    ...optional("avSyncIssue", row.av_sync_issue), ...optional("seekIssue", row.seek_issue), ...optional("notes", row.notes),
    evidenceArtifactIds: stringArray(row.evidence_artifact_ids), reportedBy: row.reported_by, reportedVia: row.reported_via,
    ...optional("testEnvironmentId", row.test_environment_id), occurredAt: row.occurred_at.toISOString(),
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
}
function toEvaluation(row: EvaluationRow): ExperimentEvaluation {
  const updates = Array.isArray(row.hypothesis_updates) ? row.hypothesis_updates as HypothesisEvaluation[] : [];
  const next = row.proposed_next_plan === null ? undefined : record(row.proposed_next_plan) as ExperimentEvaluation["proposedNextExperimentPlan"];
  return { id: row.id, experimentId: row.experiment_id, iterationId: row.iteration_id, status: row.status,
    confidence: row.confidence, summary: row.summary, hypothesisUpdates: updates, evidenceBundle: record(row.evidence_bundle),
    ...(row.analysis ? { analysis: record(row.analysis) as NonNullable<ExperimentEvaluation["analysis"]> } : {}),
    ...(next ? { proposedNextExperimentPlan: next } : {}), createdAt: row.created_at.toISOString() };
}
function toEvaluationJob(row: EvaluationJobRow): NonNullable<ExperimentDetail["evaluationJob"]> {
  return {
    id: row.id,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    ...optional("errorCode", row.error_code),
    ...optional("errorMessage", row.error_message),
    createdAt: row.created_at.toISOString(),
    ...optional("startedAt", row.started_at?.toISOString()),
    ...optional("completedAt", row.completed_at?.toISOString()),
  };
}
function record(value: unknown): Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function stringArray(value: unknown): string[] { return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []; }
function optional<K extends string, V>(key: K, value: V | null | undefined): Partial<Record<K, NonNullable<V>>> {
  return value === null || value === undefined ? {} : { [key]: value } as Partial<Record<K, NonNullable<V>>>;
}
function parseCloneSpec(value: unknown): CloneSpec {
  return CloneSpecSchema.parse(value) as unknown as CloneSpec;
}
function parseExecutionPlan(value: unknown): CloneExecutionPlan {
  return CloneExecutionPlanSchema.parse(value) as unknown as CloneExecutionPlan;
}
function parseVerification(value: unknown): CloneVerificationReport {
  return CloneVerificationReportSchema.parse(value) as unknown as CloneVerificationReport;
}
