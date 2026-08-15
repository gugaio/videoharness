import { logger } from "../../infra/logger.js";
import { aiRetryAfterMs, aiValidationIssues, classifyAiError, publicError } from "../domain/errors.js";
import { parseLeadOutput, parseSpecialistOutput } from "../domain/parsing.js";
import { LEAD_AGENT_ID, SPECIALIST_PROFILES } from "../domain/profiles.js";
import { ABR_QUALITY_INVESTIGATOR_SYSTEM_PROMPT, containerEncodingSpecialistPrompt, leadPrompt, manifestDeliverySpecialistPrompt, specialistPrompt, timelinePlaybackSpecialistPrompt } from "../domain/prompts.js";
import { buildAbrQualityAgentPacket, parseAbrQualityAgentOutput, type AbrQualityAgentOutput } from "./abr-quality-investigator-agent.js";
import type { AbrAssessment } from "../../abr/domain/assessment.js";
import type { AbrSwitchEvidence } from "../../abr/domain/evidence.js";
import type {
  AiAgentProgress,
  AiAgentRun,
  AiFinding,
  AiInvestigationResult,
  AiPromptAudit,
  SpecialistAgentId,
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
  /** Compact shared packet used by the Lead synthesis. */
  packet: string;
  /** Exclusive per-lane evidence packets; each specialist sees only the
   * evidence of its own lane so the team does not retell the same facts. */
  specialistPackets?: Partial<Record<SpecialistAgentId, SpecialistPacket>>;
  abrAssessment: AbrAssessment;
  abrTransitions: AbrSwitchEvidence[];
  onProgress?: ((update: AiAgentProgress) => Promise<void>) | undefined;
  runModel: AgentModelRunner;
  specialistTools: (audit: AiPromptAudit) => readonly unknown[];
  leadTools: (audit: AiPromptAudit) => readonly unknown[];
};

export type SpecialistPacket = {
  prompt: string;
  evidenceIds: readonly string[];
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
        specialistSystemPrompt(profile),
        input.specialistPackets?.[profile.id]?.prompt ?? input.packet,
        parseSpecialistOutput,
        input.specialistTools,
        specialistPacketMetrics(profile.id, input.specialistPackets),
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
  // The same provider credential is shared by every specialist. Serial calls
  // avoid turning one malformed response and its correction retry into a burst
  // that rate-limits the rest of the team.
  const taskResults = await runBounded(tasks, 1);
  const specialistResults = taskResults.flatMap((result) => result.kind === "general" ? [result] : []);
  const abrOutput = taskResults.find((result): result is AbrResult => result.kind === "abr")?.output;
  const completed = [
    ...specialistResults.flatMap(({ profile, output }) =>
      output ? [{ id: profile.id, output: filterSpecialist(output, input.evidenceIds, { investigationId: input.investigationId, agentId: profile.id }) }] : []),
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
  const validationPlan = validateValidationPlan(lead.validationPlan, input.abrAssessment);
  return {
    available: true,
    summary: lead.summary,
    likelyCause: lead.likelyCause,
    confidence: capConfidence(lead.confidence, filtered.findings),
    findings: filtered.findings,
    recommendations: lead.recommendations.slice(0, 6),
    limitations: filtered.limitations,
    ...(validationPlan ? { validationPlan } : {}),
    agents: team.runs,
    promptAudits: team.promptAudits,
  };
}

function specialistPacketMetrics(
  agentId: SpecialistAgentId,
  packets: RunAgentTeamInput["specialistPackets"],
): AiPromptAudit["packetMetrics"] | undefined {
  const packet = packets?.[agentId];
  if (!packet) return undefined;
  const own = new Set(packet.evidenceIds);
  const other = new Set(
    Object.entries(packets)
      .filter(([id]) => id !== agentId)
      .flatMap(([, candidate]) => candidate?.evidenceIds ?? []),
  );
  const sharedEvidenceIdCount = [...own].filter((id) => other.has(id)).length;
  return {
    packetBytes: Buffer.byteLength(packet.prompt, "utf8"),
    evidenceIdCount: own.size,
    sharedEvidenceIdCount,
    sharedEvidenceRatio: own.size === 0 ? 0 : sharedEvidenceIdCount / own.size,
  };
}

function validateValidationPlan(
  plan: import("../domain/types.js").AiValidationPlan | undefined,
  assessment: AbrAssessment,
): import("../domain/types.js").AiValidationPlan | undefined {
  if (!plan) return undefined;
  const known = new Set(assessment.ladder.representations.map((entry) => entry.id));
  const representationIds = [...new Set(plan.treatment.representationIds)];
  if (representationIds.some((id) => !known.has(id))) return undefined;
  if (plan.treatment.recipe === "single_video_representation" && representationIds.length !== 1) return undefined;
  if (plan.treatment.recipe === "representation_subset" && (representationIds.length === 0 || representationIds.length >= known.size)) return undefined;
  if (plan.treatment.recipe === "single_audio" && representationIds.length > 0) return undefined;
  return { ...plan, treatment: { ...plan.treatment, representationIds } };
}

function specialistSystemPrompt(profile: (typeof SPECIALIST_PROFILES)[number]): string {
  switch (profile.id) {
    case "manifest-delivery": return manifestDeliverySpecialistPrompt();
    case "timeline-playback": return timelinePlaybackSpecialistPrompt();
    case "container-encoding": return containerEncodingSpecialistPrompt();
    default: return specialistPrompt(profile.label, profile.focus);
  }
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
    packetMetrics?: AiPromptAudit["packetMetrics"],
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
        packetMetrics,
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
  packetMetrics?: AiPromptAudit["packetMetrics"];
}): Promise<T> {
  let lastError: unknown;
  let previousErrorType: string | undefined;
  const failureCounts = new Map<string, number>();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const startedAt = Date.now();
    logger.info("ai.agent_attempt_started", {
      investigationId: input.investigationId,
      agentId: input.agentId,
      attempt: attempt + 1,
    });
    try {
      const retryInstruction = previousErrorType === undefined
        ? ""
        : isContractError(previousErrorType)
          ? "\nThis is a contract-correction retry. Check every required field and return one valid JSON object only. Use the exact field names from the contract; arrays must remain arrays."
          : "\nThe provider request is being retried. Return exactly the requested JSON object without markdown.";
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
        ...(input.packetMetrics ? { packetMetrics: input.packetMetrics } : {}),
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
      audit.output = output;
      return output;
    } catch (error) {
      lastError = error;
      const errorType = classifyAiError(error);
      const failureCount = (failureCounts.get(errorType) ?? 0) + 1;
      failureCounts.set(errorType, failureCount);
      logger.warn("ai.agent_attempt_failed", {
        investigationId: input.investigationId,
        agentId: input.agentId,
        attempt: attempt + 1,
        durationMs: Date.now() - startedAt,
        errorType,
        ...(aiValidationIssues(error) ? { validationIssues: aiValidationIssues(error) } : {}),
      });
      if (!shouldRetry(errorType, failureCount, attempt + 1)) break;
      const delayMs = retryDelayMs(errorType, failureCount, error);
      logger.info("ai.agent_retry_scheduled", {
        investigationId: input.investigationId,
        agentId: input.agentId,
        attempt: attempt + 2,
        errorType,
        delayMs,
      });
      previousErrorType = errorType;
      await delay(delayMs);
    }
  }
  throw lastError;
}

function shouldRetry(errorType: string, failureCount: number, totalAttempts: number): boolean {
  if (totalAttempts >= 3) return false;
  if (isContractError(errorType)) return failureCount < 2;
  if (errorType === "provider_rate_limit") return failureCount < 3;
  return ["timeout", "provider_server_error", "provider_transport"].includes(errorType) && failureCount < 2;
}

function isContractError(errorType: string): boolean {
  return ["response_validation", "invalid_json", "empty_content"].includes(errorType);
}

function retryDelayMs(errorType: string, failureCount: number, error: unknown): number {
  if (errorType === "provider_rate_limit") {
    return aiRetryAfterMs(error) ?? (failureCount === 1 ? 5_000 : 15_000);
  }
  return errorType === "response_validation" || errorType === "invalid_json" || errorType === "empty_content"
    ? 250
    : 1_000;
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

/** Evidence ID prefixes each specialist may speak from. A finding without
 * in-lane evidence is another specialist's job (or a deterministic fact) and
 * is dropped before the Lead synthesis. */
const SPECIALIST_LANES: Partial<Record<SpecialistAgentId, readonly string[]>> = {
  "timeline-playback": ["timeline:", "sample:"],
  "container-encoding": ["sample:"],
  "manifest-delivery": ["manifest:"],
};

function filterSpecialist(
  output: SpecialistOutput,
  valid: Set<string>,
  lane?: { investigationId: string; agentId: SpecialistAgentId },
): SpecialistOutput {
  const cited = output.findings
    .map((finding) => ({ ...finding, evidenceIds: finding.evidenceIds.filter((id) => valid.has(id)) }))
    .filter((finding) => finding.evidenceIds.length > 0);
  const prefixes = lane ? SPECIALIST_LANES[lane.agentId] : undefined;
  const findings = prefixes
    ? cited.filter((finding) => finding.evidenceIds.some((id) => prefixes.some((prefix) => id.startsWith(prefix))))
    : cited;
  if (prefixes && findings.length !== cited.length) {
    logger.info("ai.specialist_lane_filtered", {
      investigationId: lane!.investigationId,
      agentId: lane!.agentId,
      dropped: cited.length - findings.length,
    });
  }
  return { ...output, findings, limitations: output.limitations.slice(0, 8) };
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
