import type { ExperimentEvaluation } from "../domain/experiment.js";
import type { ExperimentAgentAnalysisResult } from "../ports/experiment-analysis.js";

export function applyExperimentAgentAnalysis(
  evaluation: ExperimentEvaluation,
  result: ExperimentAgentAnalysisResult,
): ExperimentEvaluation {
  if (!evaluation.analysis) return evaluation;
  const narrative = result.narrative;
  return {
    ...evaluation,
    analysis: {
      ...evaluation.analysis,
      source: narrative ? "AI_ASSISTED" : "DETERMINISTIC",
      ...(narrative ? {
        title: narrative.title,
        interpretation: narrative.interpretation,
        alternativeExplanations: unique([...evaluation.analysis.alternativeExplanations, ...narrative.alternativeExplanations]),
        limitations: unique([...evaluation.analysis.limitations, ...narrative.additionalLimitations]),
        confidenceRationale: narrative.confidenceRationale,
        nextTest: narrative.nextTest,
      } : {}),
      agents: result.agents,
    },
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((entry) => entry.trim()).filter(Boolean))];
}
