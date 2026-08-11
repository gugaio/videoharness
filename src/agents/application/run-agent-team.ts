import { logger } from "../../infra/logger.js";
import { classifyAiError, publicError } from "../domain/errors.js";
import { parseLeadOutput, parseSpecialistOutput } from "../domain/parsing.js";
import { LEAD_AGENT_ID, SPECIALIST_PROFILES } from "../domain/profiles.js";
import { ABR_QUALITY_INVESTIGATOR_SYSTEM_PROMPT, leadPrompt, specialistPrompt } from "../domain/prompts.js";
import { buildAbrQualityAgentPacket, parseAbrQualityAgentOutput, type AbrQualityAgentOutput } from "./abr-quality-investigator-agent.js";
import type { AbrAssessment } from "../../abr/domain/assessment.js";
import type { AbrSwitchEvidence } from "../../abr/domain/evidence.js";
import type {
  AiAgentProgress,
  AiAgentRun,
  AiFinding,
  AiInvestigationResult,
  AiPromptAudit,
  SpecialistOutput,
} from "../domain/types.js";
import type { AgentModelRunner } from "../ports/agent-model-runner.js";

export type RunAgentTeamInput = {
  investigationId: string;
  protocol: "hls" | "dash";
  provider: string;
  model: string;
  hasLab: boolean;
  evidenceIds: Set<string>;
  packet: string;
  abrAssessment: AbrAssessment;
  abrTransitions: AbrSwitchEvidence[];
  onProgress?: ((update: AiAgentProgress) => Promise<void>) | undefined;
  runModel: AgentModelRunner;
  specialistTools: (audit: AiPromptAudit) => readonly unknown[];
  leadTools: (audit: AiPromptAudit) => readonly unknown[];
};

/**
 * Runs the bounded agent team: specialists with limited parallelism, then the
 * Lead synthesis. Every agent reports real lifecycle progress; a failing agent
 * never hides the other runs nor the deterministic evidence. Each model call
 * is recorded in `promptAudits` (instructions + evidence, never reasoning).
 */
export async function runAgentTeam(input: RunAgentTeamInput): Promise<AiInvestigationResult> {
  const team = new AgentTeam(input);
  type GeneralResult = { kind: "general"; profile: (typeof SPECIALIST_PROFILES)[number]; output: SpecialistOutput | undefined };
  type AbrResult = { kind: "abr"; output: AbrQualityAgentOutput | undefined };
  const tasks: Array<() => Promise<GeneralResult | AbrResult>> = [
    ...SPECIALIST_PROFILES.map((profile) => async (): Promise<GeneralResult> => ({
      kind: "general",
      profile,
      output: await team.runOne(
        profile.id,
        specialistPrompt(profile.label, profile.focus),
        input.packet,
        parseSpecialistOutput,
        input.specialistTools,
      ),
    })),
    async (): Promise<AbrResult> => ({
      kind: "abr",
      output: await team.runOne(
        "abr-switch-investigator",
        ABR_QUALITY_INVESTIGATOR_SYSTEM_PROMPT,
        JSON.stringify(buildAbrQualityAgentPacket(input.abrAssessment, input.abrTransitions)),
        parseAbrQualityAgentOutput,
        input.specialistTools,
      ),
    }),
  ];
  // Provider accounts commonly allow fewer concurrent long-running generations
  // than the team roster. A bounded fan-out avoids deterministic rate-limit
  // failures while preserving parallelism and per-agent lifecycle events.
  const taskResults = await runBounded(tasks, 2);
  const specialistResults = taskResults.flatMap((result) => result.kind === "general" ? [result] : []);
  const abrOutput = taskResults.find((result): result is AbrResult => result.kind === "abr")?.output;
  const completed = [
    ...specialistResults.flatMap(({ profile, output }) =>
      output ? [{ id: profile.id, output: filterSpecialist(output, input.evidenceIds) }] : []),
    ...(abrOutput ? [{ id: "abr-switch-investigator" as const, output: filterSpecialist(toSpecialistOutput(abrOutput), input.evidenceIds) }] : []),
  ];
  if (completed.length === 0) {
    return fallbackResult(team.runs, team.promptAudits, [], ["All AI specialists failed; deterministic evidence remains available."]);
  }

  const lead = await team.runOne(
    LEAD_AGENT_ID,
    leadPrompt(input.hasLab && input.protocol === "hls", input.protocol),
    JSON.stringify({ packet: JSON.parse(input.packet), specialists: completed }),
    parseLeadOutput,
    input.leadTools,
  );
  if (!lead) {
    return fallbackResult(team.runs, team.promptAudits, completed.flatMap((item) => item.output.findings), ["Lead synthesis failed; specialist findings are shown directly."]);
  }

  const filtered = filterSpecialist(lead, input.evidenceIds);
  return {
    available: true,
    summary: lead.summary,
    likelyCause: lead.likelyCause,
    confidence: capConfidence(lead.confidence, filtered.findings),
    findings: filtered.findings,
    recommendations: lead.recommendations.slice(0, 6),
    limitations: filtered.limitations,
    agents: team.runs,
    promptAudits: team.promptAudits,
  };
}

export function unavailableResult(): AiInvestigationResult {
  return {
    available: false,
    findings: [],
    recommendations: [],
    limitations: ["AI analysis is unavailable because no provider API key is configured."],
    agents: [...SPECIALIST_PROFILES.map((profile) => ({ id: profile.id, state: "unavailable" as const })), { id: "abr-switch-investigator" as const, state: "unavailable" as const }, { id: LEAD_AGENT_ID, state: "unavailable" as const }],
    promptAudits: [],
  };
}

/**
 * Holds the shared run state (progress counters and agent outcomes) and runs
 * one agent at a time, reporting its real lifecycle to the caller.
 */
class AgentTeam {
  readonly runs: AiAgentRun[] = [];
  readonly promptAudits: AiPromptAudit[] = [];
  private readonly total: number;

  constructor(private readonly input: RunAgentTeamInput) { this.total = SPECIALIST_PROFILES.length + 2; }

  async runOne<T extends { summary: string }>(
    agentId: AiAgentRun["id"],
    systemPrompt: string,
    prompt: string,
    parse: (value: unknown) => T,
    createTools: (audit: AiPromptAudit) => readonly unknown[],
  ): Promise<T | undefined> {
    await this.report({ agent: agentId, stage: "started" });
    try {
      const output = await runStructured({
        investigationId: this.input.investigationId,
        agentId,
        systemPrompt,
        prompt,
        createTools,
        parse,
        runModel: this.input.runModel,
        promptAudits: this.promptAudits,
        provider: this.input.provider,
        model: this.input.model,
      });
      this.runs.push({ id: agentId, state: "completed", summary: output.summary });
      await this.report({ agent: agentId, stage: "completed" });
      return output;
    } catch (error) {
      const limitation = publicError(error);
      this.runs.push({ id: agentId, state: "failed", limitation });
      await this.report({ agent: agentId, stage: "failed", limitation });
      return undefined;
    }
  }

  private async report(update: Pick<AiAgentProgress, "agent" | "stage" | "limitation">): Promise<void> {
    if (!this.input.onProgress) return;
    try {
      await this.input.onProgress({ ...update, completed: this.runs.length, total: this.total });
    } catch (error) {
      logger.warn("ai.progress_callback_failed", {
        investigationId: this.input.investigationId,
        agentId: update.agent,
        errorType: error instanceof Error ? error.name : "unknown",
      });
    }
  }
}

async function runStructured<T>(input: {
  investigationId: string;
  agentId: AiAgentRun["id"];
  systemPrompt: string;
  prompt: string;
  createTools: (audit: AiPromptAudit) => readonly unknown[];
  parse: (value: unknown) => T;
  runModel: AgentModelRunner;
  promptAudits: AiPromptAudit[];
  provider: string;
  model: string;
}): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) await delay(1_000);
    const startedAt = Date.now();
    logger.info("ai.agent_attempt_started", {
      investigationId: input.investigationId,
      agentId: input.agentId,
      attempt: attempt + 1,
    });
    try {
      const retryInstruction = attempt === 0
        ? ""
        : "\nThis is a contract-correction retry. Check every required field and return one valid JSON object only.";
      const prompt = `${input.prompt}${retryInstruction}`;
      const audit: AiPromptAudit = {
        agentId: input.agentId,
        attempt: attempt + 1,
        state: "failed",
        provider: input.provider,
        model: input.model,
        systemPrompt: input.systemPrompt,
        prompt,
        toolNames: [],
        toolCalls: [],
      };
      input.promptAudits.push(audit);
      const tools = input.createTools(audit);
      audit.toolNames = tools.flatMap((tool) =>
        tool && typeof tool === "object" && "name" in tool && typeof tool.name === "string" ? [tool.name] : []);
      const output = input.parse(await input.runModel({
        investigationId: input.investigationId,
        agentId: input.agentId,
        systemPrompt: input.systemPrompt,
        prompt,
        tools,
      }));
      logger.info("ai.agent_attempt_completed", {
        investigationId: input.investigationId,
        agentId: input.agentId,
        attempt: attempt + 1,
        durationMs: Date.now() - startedAt,
      });
      audit.state = "completed";
      return output;
    } catch (error) {
      lastError = error;
      logger.warn("ai.agent_attempt_failed", {
        investigationId: input.investigationId,
        agentId: input.agentId,
        attempt: attempt + 1,
        durationMs: Date.now() - startedAt,
        errorType: classifyAiError(error),
      });
    }
  }
  throw lastError;
}

async function runBounded<T>(tasks: Array<() => Promise<T>>, concurrency: number): Promise<T[]> {
  const results = new Array<T>(tasks.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= tasks.length) return;
      results[index] = await tasks[index]!();
    }
  });
  await Promise.all(workers);
  return results;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function fallbackResult(agents: AiAgentRun[], promptAudits: AiPromptAudit[], findings: AiFinding[], limitations: string[]): AiInvestigationResult {
  return { available: true, findings, recommendations: [], limitations, agents, promptAudits };
}

function filterSpecialist(output: SpecialistOutput, valid: Set<string>): SpecialistOutput {
  return {
    ...output,
    findings: output.findings
      .map((finding) => ({ ...finding, evidenceIds: finding.evidenceIds.filter((id) => valid.has(id)) }))
      .filter((finding) => finding.evidenceIds.length > 0),
    limitations: output.limitations.slice(0, 8),
  };
}

function capConfidence(value: number, findings: AiFinding[]): number {
  return findings.length === 0 ? 0.2 : Math.min(value, 0.75);
}

function toSpecialistOutput(output: AbrQualityAgentOutput): SpecialistOutput {
  const confidence = { LOW: 0.3, MEDIUM: 0.55, HIGH: 0.78, VERY_HIGH: 0.92 } as const;
  return {
    summary: output.summary,
    findings: output.findings.map((finding) => ({
      title: finding.title,
      severity: finding.severity === "INFO" || finding.severity === "LOW" ? "info" : finding.severity === "MEDIUM" ? "warning" : "error",
      explanation: `${finding.technical_explanation}${finding.why_this_affects_abr ? ` ${finding.why_this_affects_abr}` : ""}`.trim(),
      evidenceIds: finding.evidence_ids,
      confidence: confidence[finding.confidence],
    })),
    limitations: [...new Set([...output.missing_evidence, ...output.recommended_measurements.map((test) => `Recommended measurement: ${test}`)])].slice(0, 12),
  };
}
