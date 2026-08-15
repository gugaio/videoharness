export type StartInvestigationAnalysisResult =
  | "started"
  | "already_started"
  | "not_ready"
  | "not_found";

export type StartInvestigationAnalysis = (
  investigationId: string,
  options?: { rerun?: boolean },
) => Promise<StartInvestigationAnalysisResult>;
