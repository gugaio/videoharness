import type { EvidenceBundleV2 } from "../domain/evidence.js";

export type AiFinding = {
  title: string;
  severity: "info" | "warning" | "error";
  explanation: string;
  evidenceIds: string[];
  confidence: number;
};

export type AiAgentRun = {
  id: "timeline-playback" | "container-encoding" | "manifest-delivery" | "lead-investigator";
  state: "completed" | "failed" | "unavailable";
  summary?: string;
  limitation?: string;
};

export type AiInvestigationResult = {
  available: boolean;
  summary?: string;
  likelyCause?: string;
  confidence?: number;
  findings: AiFinding[];
  recommendations: string[];
  limitations: string[];
  agents: AiAgentRun[];
};

export interface InvestigationAI {
  investigate(input: {
    investigationId: string;
    problemDescription?: string;
    evidence: EvidenceBundleV2;
  }): Promise<AiInvestigationResult>;
}
