import type { EvidenceBundleV1, EvidenceBundleV2, EvidenceBundleV3 } from "./evidence.js";
import type { AiInvestigationResult } from "../ports/investigation-ai.js";

export type PhaseOnePlaceholderReportContent = {
  placeholder: true;
  title: string;
  summary: string;
  problemReported?: string;
  findings: Array<{
    title: string;
    status: "not_run";
    explanation: string;
  }>;
  confidence: {
    level: "not_assessed";
    explanation: string;
  };
  ai?: AiInvestigationResult;
  generatedBy: "phase-1-lifecycle-fixture";
};

type ManifestEvidenceReportBase = {
  placeholder: false;
  title: string;
  summary: string;
  problemReported?: string;
  findings: Array<{
    title: string;
    status: "observed" | "limitation";
    explanation: string;
  }>;
  confidence: {
    level: "limited";
    explanation: string;
  };
};

export type ManifestEvidenceReportContent = ManifestEvidenceReportBase & (
  | { evidence: EvidenceBundleV1; generatedBy: "deterministic-manifest-v1" }
  | { evidence: EvidenceBundleV2; generatedBy: "deterministic-manifest-v2" }
  | { evidence: EvidenceBundleV2; generatedBy: "deterministic-media-v1" }
  | { evidence: EvidenceBundleV3; generatedBy: "deterministic-playback-v1" }
);

export type InvestigationReportContent =
  | PhaseOnePlaceholderReportContent
  | ManifestEvidenceReportContent;

export type InvestigationReport = {
  id: string;
  investigationId: string;
  schemaVersion: number;
  content: InvestigationReportContent;
  createdAt: string;
  updatedAt: string;
};
