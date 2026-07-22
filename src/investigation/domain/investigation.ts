export const investigationStates = [
  "queued",
  "validating",
  "collecting",
  "analyzing",
  "synthesizing",
  "completed",
  "failed",
] as const;

export type InvestigationState = (typeof investigationStates)[number];

export type Investigation = {
  id: string;
  sourceUrl: string;
  problemDescription?: string;
  state: InvestigationState;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};
