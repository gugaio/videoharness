import type pg from "pg";
import { EvidenceBundleV2Schema, EvidenceBundleV3Schema, InvestigationReportContentSchema } from "../../contracts/investigation.js";
import type { AgentId, AiPromptAudit } from "../../agents/domain/types.js";
import type { InvestigationEvent } from "../domain/investigation-event.js";
import type { InvestigationReport, InvestigationReportContent } from "../domain/investigation-report.js";
import type { Investigation } from "../domain/investigation.js";
import type { EvidenceBundleV2, EvidenceBundleV3 } from "../domain/evidence.js";
import type { InvestigationArtifact, InvestigationQueryRepository } from "../ports/investigation-query.js";

type InvestigationRow = {
  id: string;
  source_url: string;
  problem_description: string | null;
  state: Investigation["state"];
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
};

type InvestigationEventRow = {
  id: string;
  investigation_id: string;
  type: string;
  actor: string;
  message: string;
  payload: Record<string, unknown>;
  created_at: Date;
};

type InvestigationReportRow = {
  id: string;
  investigation_id: string;
  schema_version: number;
  content: unknown;
  created_at: Date;
  updated_at: Date;
};
type ArtifactRow = { id: string; logical_key: string; kind: string; storage_key: string; content_type: string | null; size_bytes: number | null; created_at: Date };
type EvidenceRow = { evidence: unknown };
type AgentRunRow = { agent_id: AgentId; attempt: number; state: "completed" | "failed"; provider: string; model: string; system_prompt: string; prompt: string; tool_names: unknown; tool_calls: unknown; packet_metrics: unknown; output: unknown };

function toInvestigation(row: InvestigationRow): Investigation {
  return {
    id: row.id,
    sourceUrl: row.source_url,
    ...(row.problem_description ? { problemDescription: row.problem_description } : {}),
    state: row.state,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    ...(row.completed_at ? { completedAt: row.completed_at.toISOString() } : {}),
  };
}

export class PostgresInvestigationQuery implements InvestigationQueryRepository {
  constructor(private readonly pool: pg.Pool) {}

  async findById(id: string): Promise<Investigation | null> {
    const result = await this.pool.query<InvestigationRow>(
      `SELECT id, source_url, problem_description, state, created_at, updated_at, completed_at
         FROM investigations
        WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? toInvestigation(result.rows[0]) : null;
  }

  async list(limit = 100): Promise<Investigation[]> {
    const result = await this.pool.query<InvestigationRow>(
      `SELECT id, source_url, problem_description, state, created_at, updated_at, completed_at
         FROM investigations
        ORDER BY created_at DESC
        LIMIT $1`,
      [Math.max(1, Math.min(500, limit))],
    );
    return result.rows.map(toInvestigation);
  }

  async listEventsAfter(investigationId: string, afterEventId: string, limit: number): Promise<InvestigationEvent[]> {
    const result = await this.pool.query<InvestigationEventRow>(
      `SELECT id, investigation_id, type, actor, message, payload, created_at
         FROM investigation_events
        WHERE investigation_id = $1 AND id > $2::bigint
        ORDER BY id ASC
        LIMIT $3`,
      [investigationId, afterEventId, limit],
    );
    return result.rows.map((row) => ({
      id: row.id,
      investigationId: row.investigation_id,
      type: row.type,
      actor: row.actor,
      message: row.message,
      payload: row.payload,
      createdAt: row.created_at.toISOString(),
    }));
  }

  async findReport(investigationId: string): Promise<InvestigationReport | null> {
    const result = await this.pool.query<InvestigationReportRow>(
      `SELECT id, investigation_id, schema_version, content, created_at, updated_at
         FROM reports
        WHERE investigation_id = $1`,
      [investigationId],
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          investigationId: row.investigation_id,
          schemaVersion: row.schema_version,
          content: InvestigationReportContentSchema.parse(row.content) as InvestigationReportContent,
          createdAt: row.created_at.toISOString(),
          updatedAt: row.updated_at.toISOString(),
        }
      : null;
  }

  async findEvidence(investigationId: string): Promise<EvidenceBundleV2 | EvidenceBundleV3 | null> {
    const result = await this.pool.query<EvidenceRow>(
      `SELECT evidence
         FROM evidence_snapshots
        WHERE investigation_id = $1
        ORDER BY revision DESC
        LIMIT 1`,
      [investigationId],
    );
    const evidence = result.rows[0]?.evidence;
    if (!evidence || typeof evidence !== "object") return null;
    const schemaVersion = (evidence as { schemaVersion?: unknown }).schemaVersion;
    if (schemaVersion === 2) return EvidenceBundleV2Schema.parse(evidence) as EvidenceBundleV2;
    if (schemaVersion === 3) return EvidenceBundleV3Schema.parse(evidence) as EvidenceBundleV3;
    return null;
  }

  async listAgentRuns(investigationId: string): Promise<AiPromptAudit[]> {
    const result = await this.pool.query<AgentRunRow>(
      `SELECT agent_id, attempt, state, provider, model, system_prompt, prompt, tool_names, tool_calls, packet_metrics, output
         FROM agent_runs
        WHERE investigation_id = $1
        ORDER BY created_at, agent_id, attempt`,
      [investigationId],
    );
    return result.rows.map((row) => ({
      agentId: row.agent_id,
      attempt: row.attempt,
      state: row.state,
      provider: row.provider,
      model: row.model,
      systemPrompt: row.system_prompt,
      prompt: row.prompt,
      toolNames: stringArray(row.tool_names),
      toolCalls: toolCalls(row.tool_calls),
      ...packetMetrics(row.packet_metrics),
      ...(row.output === null ? {} : { output: row.output }),
    }));
  }

  async listArtifacts(investigationId: string): Promise<InvestigationArtifact[]> {
    const result = await this.pool.query<ArtifactRow>(`SELECT id, logical_key, kind, storage_key, content_type, size_bytes, created_at FROM artifacts WHERE investigation_id=$1 ORDER BY logical_key`, [investigationId]);
    return result.rows.map(toArtifact);
  }

  async findArtifact(investigationId: string, artifactId: string): Promise<InvestigationArtifact | null> {
    const result = await this.pool.query<ArtifactRow>(`SELECT id, logical_key, kind, storage_key, content_type, size_bytes, created_at FROM artifacts WHERE investigation_id=$1 AND id=$2`, [investigationId, artifactId]);
    return result.rows[0] ? toArtifact(result.rows[0]) : null;
  }
}
function packetMetrics(value: unknown): Pick<AiPromptAudit, "packetMetrics"> {
  if (value === null || typeof value !== "object") return {};
  const metrics = value as Record<string, unknown>;
  return typeof metrics.packetBytes === "number"
    && typeof metrics.evidenceIdCount === "number"
    && typeof metrics.sharedEvidenceIdCount === "number"
    && typeof metrics.sharedEvidenceRatio === "number"
    ? { packetMetrics: {
        packetBytes: metrics.packetBytes,
        evidenceIdCount: metrics.evidenceIdCount,
        sharedEvidenceIdCount: metrics.sharedEvidenceIdCount,
        sharedEvidenceRatio: metrics.sharedEvidenceRatio,
      } }
    : {};
}

function toArtifact(row: ArtifactRow): InvestigationArtifact { return { id: row.id, logicalKey: row.logical_key, kind: row.kind, storageKey: row.storage_key, ...(row.content_type ? { contentType: row.content_type } : {}), ...(row.size_bytes === null ? {} : { sizeBytes: row.size_bytes }), createdAt: row.created_at.toISOString() }; }
function stringArray(value: unknown): string[] { return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []; }
function toolCalls(value: unknown): AiPromptAudit["toolCalls"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (entry === null || typeof entry !== "object") return [];
    const call = entry as Record<string, unknown>;
    return typeof call.name === "string" && typeof call.input === "string" && typeof call.output === "string"
      ? [{ name: call.name, input: call.input, output: call.output }]
      : [];
  });
}
