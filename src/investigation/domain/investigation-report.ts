import type { EvidenceBundle } from "./evidence.js";

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
  generatedBy: "phase-1-lifecycle-fixture";
};

export type ManifestEvidenceReportContent = {
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
  evidence: EvidenceBundle;
  generatedBy: "deterministic-manifest-v1";
};

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
