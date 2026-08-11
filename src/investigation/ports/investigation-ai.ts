import type { EvidenceBundleV2, EvidenceBundleV3 } from "../domain/evidence.js";
import type { AiAgentProgress, AiInvestigationResult } from "../../agents/domain/types.js";

export type { AiFinding, AiAgentRun, AiAgentProgress, AiInvestigationResult } from "../../agents/domain/types.js";

/**
 * AI analysis boundary for an investigation. Implementations must not leak
 * provider SDK types; they receive serializable evidence and return a
 * structured, bounded result. Without a provider key the result keeps
 * `available: false` and the deterministic evidence remains authoritative.
 */
export interface InvestigationAI {
  investigate(input: {
    investigationId: string;
    problemDescription?: string;
    evidence: EvidenceBundleV2 | EvidenceBundleV3;
    onProgress?: (update: AiAgentProgress) => Promise<void>;
  }): Promise<AiInvestigationResult>;
}
