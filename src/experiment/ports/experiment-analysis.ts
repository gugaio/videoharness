import type { ExperimentCausalAnalysis, ExperimentDetail, ExperimentEvaluation } from "../domain/experiment.js";

export type ExperimentAgentRun = ExperimentCausalAnalysis["agents"][number];

export type ExperimentAgentNarrative = {
  title: string;
  interpretation: string;
  alternativeExplanations: string[];
  additionalLimitations: string[];
  confidenceRationale: string;
  nextTest: ExperimentCausalAnalysis["nextTest"];
};

export type ExperimentAgentAnalysisResult = {
  narrative?: ExperimentAgentNarrative;
  agents: ExperimentAgentRun[];
};

/**
 * AI boundary for post-experiment interpretation. Deterministic evaluation
 * establishes the observed comparison and causal ceiling before this port is
 * called; agents may explain and plan, but cannot rewrite those facts.
 */
export interface ExperimentAnalysisTeam {
  analyze(input: {
    experiment: ExperimentDetail;
    evaluation: ExperimentEvaluation;
  }): Promise<ExperimentAgentAnalysisResult>;
}
