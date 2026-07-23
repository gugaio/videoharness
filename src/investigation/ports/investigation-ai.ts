import type { EvidenceBundleV2, EvidenceBundleV3 } from "../domain/evidence.js";

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

/**
 * Real lifecycle progress of one AI agent run. `completed`/`total` count the
 * bounded, known set of agent runs (specialists plus Lead), never an estimate.
 */
export type AiAgentProgress = {
  agent: AiAgentRun["id"];
  stage: "started" | "completed" | "failed";
  completed: number;
  total: number;
  limitation?: string;
};

export interface InvestigationAI {
  investigate(input: {
    investigationId: string;
    problemDescription?: string;
    evidence: EvidenceBundleV2 | EvidenceBundleV3;
    onProgress?: (update: AiAgentProgress) => Promise<void>;
  }): Promise<AiInvestigationResult>;
}
