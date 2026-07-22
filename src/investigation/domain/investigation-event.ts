export type InvestigationEvent = {
  id: string;
  investigationId: string;
  type: string;
  actor: string;
  message: string;
  payload: Record<string, unknown>;
  createdAt: string;
};
