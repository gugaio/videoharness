export type SpecialistAgentId = "timeline-playback" | "container-encoding" | "manifest-delivery" | "abr-switch-investigator";
export type AgentId = SpecialistAgentId | "lead-investigator";

export type AiFinding = {
  title: string;
  severity: "info" | "warning" | "error";
  explanation: string;
  evidenceIds: string[];
  confidence: number;
};

export type AiAgentRun = {
  id: AgentId;
  state: "completed" | "failed" | "unavailable";
  summary?: string;
  limitation?: string;
  /** Full prompt text sent to the model for this agent (system + user). */
  prompts?: { system: string; user: string };
};

/** Input sent to one model call. This deliberately excludes model reasoning. */
export type AiPromptAudit = {
  agentId: AgentId;
  attempt: number;
  state: "completed" | "failed";
  provider: string;
  model: string;
  systemPrompt: string;
  prompt: string;
  toolNames: string[];
  toolCalls: Array<{ name: string; input: string; output: string }>;
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
  promptAudits: AiPromptAudit[];
};

/**
 * Real lifecycle progress of one AI agent run. `completed`/`total` count the
 * bounded, known set of agent runs (specialists plus Lead), never an estimate.
 */
export type AiAgentProgress = {
  agent: AgentId;
  stage: "started" | "completed" | "failed";
  completed: number;
  total: number;
  limitation?: string;
};

export type SpecialistOutput = {
  summary: string;
  findings: AiFinding[];
  limitations: string[];
};

export type LeadOutput = SpecialistOutput & {
  likelyCause: string;
  recommendations: string[];
  confidence: number;
};
