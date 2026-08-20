import { JsonStore } from "../../store/json-file.js";
import { EvidenceBundleV2Schema, EvidenceBundleV3Schema, InvestigationReportContentSchema } from "../../contracts/investigation.js";
import type { AiPromptAudit } from "../../agents/domain/types.js";
import type { InvestigationEvent } from "../domain/investigation-event.js";
import type { InvestigationReport } from "../domain/investigation-report.js";
import type { Investigation } from "../domain/investigation.js";
import type { EvidenceBundleV2, EvidenceBundleV3 } from "../domain/evidence.js";
import type { InvestigationArtifact, InvestigationQueryRepository } from "../ports/investigation-query.js";

type StoredInvestigation = {
  id: string;
  sourceUrl: string;
  problemDescription?: string;
  state: Investigation["state"];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

type StoredEvent = InvestigationEvent;

type StoredReport = {
  id: string;
  investigationId: string;
  schemaVersion: number;
  content: unknown;
  createdAt: string;
  updatedAt: string;
};

type StoredArtifact = {
  id: string;
  logicalKey: string;
  kind: string;
  storageKey: string;
  contentType?: string;
  sizeBytes?: number;
  createdAt: string;
};

export class FilesystemInvestigationQuery implements InvestigationQueryRepository {
  constructor(private readonly store: JsonStore) {}

  async findById(id: string): Promise<Investigation | null> {
    const row = await this.store.readJson<StoredInvestigation>("investigations", id, "investigation.json");
    return row ? toInvestigation(row) : null;
  }

  async list(limit = 100): Promise<Investigation[]> {
    const bounded = Math.max(1, Math.min(500, limit));
    const directories = await this.store.listSubdirectories("investigations");
    const rows: Investigation[] = [];
    for (const id of directories) {
      const row = await this.store.readJson<StoredInvestigation>("investigations", id, "investigation.json");
      if (row) rows.push(toInvestigation(row));
    }
    return rows.sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, bounded);
  }

  async listEventsAfter(investigationId: string, afterEventId: string, limit: number): Promise<InvestigationEvent[]> {
    const events = await this.store.readJsonl<StoredEvent>("investigations", investigationId, "events.jsonl");
    return events
      .filter((event) => event.id > afterEventId)
      .sort((left, right) => left.id.localeCompare(right.id))
      .slice(0, limit);
  }

  async findReport(investigationId: string): Promise<InvestigationReport | null> {
    const row = await this.store.readJson<StoredReport>("investigations", investigationId, "report.json");
    if (!row) return null;
    return {
      id: row.id,
      investigationId: row.investigationId,
      schemaVersion: row.schemaVersion,
      content: InvestigationReportContentSchema.parse(row.content) as InvestigationReport["content"],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async findEvidence(investigationId: string): Promise<EvidenceBundleV2 | EvidenceBundleV3 | null> {
    const latest = await this.store.readJson<{ snapshotId: string }>(
      "investigations", investigationId, "evidence-latest.json",
    );
    if (!latest) return null;
    const snapshot = await this.store.readJson<{ evidence: unknown }>(
      "investigations", investigationId, "evidence", `${latest.snapshotId}.json`,
    );
    const evidence = snapshot?.evidence;
    if (!evidence || typeof evidence !== "object") return null;
    const schemaVersion = (evidence as { schemaVersion?: unknown }).schemaVersion;
    if (schemaVersion === 2) return EvidenceBundleV2Schema.parse(evidence) as EvidenceBundleV2;
    if (schemaVersion === 3) return EvidenceBundleV3Schema.parse(evidence) as EvidenceBundleV3;
    return null;
  }

  async listAgentRuns(investigationId: string): Promise<AiPromptAudit[]> {
    const runs = await this.store.readJsonl<AiPromptAudit & { evidenceSnapshotId?: string; recordedAt?: string }>(
      "investigations", investigationId, "agent-runs.jsonl",
    );
    return runs
      .map(({ evidenceSnapshotId: _snapshot, recordedAt: _recordedAt, ...run }) => run)
      .sort((left, right) =>
        left.agentId.localeCompare(right.agentId) || left.attempt - right.attempt);
  }

  async listArtifacts(investigationId: string): Promise<InvestigationArtifact[]> {
    const artifacts = await this.store.readJson<StoredArtifact[]>(
      "investigations", investigationId, "artifacts.json",
    ) ?? [];
    return artifacts
      .slice()
      .sort((left, right) => left.logicalKey.localeCompare(right.logicalKey))
      .map(toArtifact);
  }

  async findArtifact(investigationId: string, artifactId: string): Promise<InvestigationArtifact | null> {
    const artifacts = await this.store.readJson<StoredArtifact[]>(
      "investigations", investigationId, "artifacts.json",
    ) ?? [];
    const artifact = artifacts.find((entry) => entry.id === artifactId);
    return artifact ? toArtifact(artifact) : null;
  }
}

function toInvestigation(row: StoredInvestigation): Investigation {
  return {
    id: row.id,
    sourceUrl: row.sourceUrl,
    ...(row.problemDescription ? { problemDescription: row.problemDescription } : {}),
    state: row.state,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.completedAt ? { completedAt: row.completedAt } : {}),
  };
}

function toArtifact(row: StoredArtifact): InvestigationArtifact {
  return {
    id: row.id,
    logicalKey: row.logicalKey,
    kind: row.kind,
    storageKey: row.storageKey,
    ...(row.contentType ? { contentType: row.contentType } : {}),
    ...(row.sizeBytes === undefined ? {} : { sizeBytes: row.sizeBytes }),
    createdAt: row.createdAt,
  };
}