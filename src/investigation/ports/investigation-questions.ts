export type AskInvestigationQuestion = (input: {
  investigationId: string;
  question: string;
}) => Promise<boolean>;
