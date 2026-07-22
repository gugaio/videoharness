export type InvestigationReportContent = {
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

export type InvestigationReport = {
  id: string;
  investigationId: string;
  schemaVersion: number;
  content: InvestigationReportContent;
  createdAt: string;
  updatedAt: string;
};
