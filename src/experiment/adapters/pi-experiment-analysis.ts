import { z } from "zod";
import { createPiModelRunner } from "../../agents/adapters/pi-model-runner.js";
import type { AgentId } from "../../agents/domain/types.js";
import type { AgentModelRunner } from "../../agents/ports/agent-model-runner.js";
import type { ExperimentDetail, ExperimentEvaluation } from "../domain/experiment.js";
import type { ExperimentAgentAnalysisResult, ExperimentAgentNarrative, ExperimentAgentRun, ExperimentAnalysisTeam } from "../ports/experiment-analysis.js";

const StringOrObjectSchema = z.union([z.string().min(1).max(4_000), z.record(z.string(), z.unknown()).transform(summarizeObject)]);
const StringOrObjectListSchema = z.array(StringOrObjectSchema).max(12);
const EvidenceQualitySchema = z.union([
  z.enum(["LOW", "MEDIUM", "HIGH"]),
  z.record(z.string(), z.unknown()).transform((value) => qualityFromObject(value)),
]);

const AuditorSchema = z.object({
  summary: StringOrObjectSchema,
  observedComparison: StringOrObjectSchema,
  evidenceQuality: EvidenceQualitySchema,
  contradictions: StringOrObjectListSchema,
  missingEvidence: StringOrObjectListSchema,
}).strict();

const CausalSchema = z.object({
  summary: StringOrObjectSchema,
  interpretation: StringOrObjectSchema,
  alternativeExplanations: StringOrObjectListSchema.pipe(z.array(z.string()).min(1)),
  claimsNotEstablished: StringOrObjectListSchema.pipe(z.array(z.string()).min(1)),
  nextMeasurements: StringOrObjectListSchema.pipe(z.array(z.string()).min(1)),
}).strict();

const LeadSchema = z.object({
  causalScope: z.enum(["TREATMENT_EFFECT_ONLY", "NO_TREATMENT_EFFECT", "INCONCLUSIVE"]),
  title: z.string().min(1).max(240),
  interpretation: z.string().min(1).max(4_000),
  alternativeExplanations: z.array(z.string().min(1).max(1_200)).min(1).max(12),
  additionalLimitations: z.array(z.string().min(1).max(1_200)).max(12),
  confidenceRationale: z.string().min(1).max(2_000),
  nextTest: z.object({
    title: z.string().min(1).max(240),
    rationale: z.string().min(1).max(2_000),
    change: z.string().min(1).max(2_000),
    expectedSignal: z.string().min(1).max(2_000),
  }).strict(),
}).strict();

type AuditorOutput = z.infer<typeof AuditorSchema>;
type CausalOutput = z.infer<typeof CausalSchema>;

export class PiExperimentAnalysisTeam implements ExperimentAnalysisTeam {
  private readonly runner: AgentModelRunner;

  constructor(private readonly config: {
    apiKey?: string;
    provider: string;
    apiUrl: string;
    model: string;
    timeoutMs: number;
    runner?: AgentModelRunner;
  }) {
    this.runner = config.runner ?? createPiModelRunner({
      apiKey: config.apiKey ?? "",
      provider: config.provider,
      apiUrl: config.apiUrl,
      model: config.model,
      timeoutMs: config.timeoutMs,
    });
  }

  async analyze(input: { experiment: ExperimentDetail; evaluation: ExperimentEvaluation }): Promise<ExperimentAgentAnalysisResult> {
    if (!this.config.apiKey && !this.config.runner) return { agents: unavailableRuns("AI provider is not configured.") };
    const packet = compactPacket(input.experiment, input.evaluation);
    const agents: ExperimentAgentRun[] = [];

    const auditor = await this.runAgent({
      id: "experiment-evidence-auditor",
      label: "Evidence Auditor",
      investigationId: input.experiment.investigationId,
      systemPrompt: auditorSystemPrompt,
      prompt: `${sharedRules}\n\nEvidence packet:\n${JSON.stringify(packet)}\n\nReturn JSON with keys: summary, observedComparison, evidenceQuality, contradictions, missingEvidence.`,
      schema: AuditorSchema,
      agents,
    });
    const causal = await this.runAgent({
      id: "experiment-causal-analyst",
      label: "Causal Analyst",
      investigationId: input.experiment.investigationId,
      systemPrompt: causalSystemPrompt,
      prompt: `${sharedRules}\n\nEvidence packet:\n${JSON.stringify(packet)}\n\nEvidence Auditor output:\n${JSON.stringify(auditor ?? { unavailable: true })}\n\nReturn JSON with keys: summary, interpretation, alternativeExplanations, claimsNotEstablished, nextMeasurements.`,
      schema: CausalSchema,
      agents,
    });
    const lead = await this.runAgent({
      id: "experiment-lead-investigator",
      label: "Lead Experiment Investigator",
      investigationId: input.experiment.investigationId,
      systemPrompt: leadSystemPrompt,
      prompt: `${sharedRules}\n\nDeterministic evidence packet:\n${JSON.stringify(packet)}\n\nEvidence Auditor output:\n${JSON.stringify(auditor ?? { unavailable: true })}\n\nCausal Analyst output:\n${JSON.stringify(causal ?? { unavailable: true })}\n\nReturn JSON with keys: causalScope, title, interpretation, alternativeExplanations, additionalLimitations, confidenceRationale, nextTest. causalScope must be ${expectedCausalScope(input.evaluation)}. nextTest must contain title, rationale, change, expectedSignal.`,
      schema: LeadSchema,
      agents,
    });

    const expectedScope = expectedCausalScope(input.evaluation);
    const narrative = lead && lead.causalScope === expectedScope ? withoutCausalScope(lead) : undefined;
    if (lead && !narrative) {
      const run = agents.find((entry) => entry.id === "experiment-lead-investigator");
      if (run) {
        run.state = "FAILED";
        delete run.summary;
        run.limitation = `Lead causalScope ${lead.causalScope} exceeded deterministic scope ${expectedScope}.`;
      }
    }
    return { ...(narrative ? { narrative } : {}), agents };
  }

  private async runAgent<T>(input: {
    id: AgentId & ExperimentAgentRun["id"];
    label: string;
    investigationId: string;
    systemPrompt: string;
    prompt: string;
    schema: z.ZodType<T>;
    agents: ExperimentAgentRun[];
  }): Promise<T | undefined> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const raw = await this.runner({
          investigationId: input.investigationId,
          agentId: input.id,
          systemPrompt: input.systemPrompt,
          prompt: attempt === 1 ? input.prompt : `${input.prompt}\n\nYour previous response did not satisfy the exact JSON contract. Return only one valid JSON object with every requested key.`,
          tools: [],
        });
        const parsed = input.schema.parse(raw);
        input.agents.push({ id: input.id, label: input.label, state: "COMPLETED", summary: outputSummary(parsed) });
        return parsed;
      } catch (error) {
        lastError = error;
      }
    }
    input.agents.push({
      id: input.id,
      label: input.label,
      state: "FAILED",
      limitation: lastError instanceof Error ? lastError.message.slice(0, 500) : "Agent analysis failed.",
    });
    return undefined;
  }
}

function compactPacket(experiment: ExperimentDetail, evaluation: ExperimentEvaluation): object {
  const iteration = experiment.iterations.at(-1);
  const requests = experiment.testRequests.filter((entry) => entry.iterationId === iteration?.id);
  return {
    goal: experiment.goal,
    hypotheses: experiment.hypotheses.map((entry) => ({ id: entry.id, statement: entry.statement, rationale: entry.rationale })),
    deterministicGuardrail: evaluation.analysis,
    originalEvidence: evaluation.evidenceBundle.original,
    environment: experiment.targetEnvironment ?? null,
    comparisons: requests.map((request) => {
      const clone = experiment.clones.find((entry) => entry.id === request.cloneId);
      return {
        label: request.shortLabel,
        role: clone?.isControl ? "CONTROL" : "TREATMENT",
        targetedHypothesisIds: request.hypothesisIds,
        change: clone?.executionPlan.whatChanged,
        transformations: clone?.executionPlan.transformations,
        selection: clone?.executionPlan.selection,
        verification: clone?.verification ? { status: clone.verification.status, warnings: clone.verification.warnings, errors: clone.verification.errors } : null,
        result: request.result ? {
          outcome: request.result.outcome,
          failureStage: request.result.failureStage,
          timeToFirstFrameMs: request.result.timeToFirstFrameMs,
          stallObserved: request.result.stallObserved,
          audioObserved: request.result.audioObserved,
          videoObserved: request.result.videoObserved,
          avSyncIssue: request.result.avSyncIssue,
          seekIssue: request.result.seekIssue,
          notes: request.result.notes,
          evidenceArtifactIds: request.result.evidenceArtifactIds,
          reportedVia: request.result.reportedVia,
        } : null,
      };
    }),
  };
}

const sharedRules = `Use the same language as the original hypothesis. Analyze only the supplied structured evidence. Do not expose chain of thought. Do not invent playback, decode, rendered-frame, request-journal, latency, throughput, device, repetition, or artifact observations. The deterministic guardrail is authoritative: do not broaden its supportedClaim, remove its notEstablished items, change its outcome, or convert a partially supported causal hypothesis into a proven cause. If the original hypothesis appears in notEstablished, call it unresolved; never describe it as likely, most likely, supported, confirmed, or still the leading cause. Distinguish an observed treatment effect from its possible mechanisms. Output JSON only.`;

const auditorSystemPrompt = `You are the post-experiment Evidence Auditor for a video streaming investigation. Verify what CONTROL and each treatment actually changed, what was reported, whether clone verification passed, and how strong the attribution is. Identify contradictions and missing evidence. Your role is factual auditing, not causal diagnosis.`;
const causalSystemPrompt = `You are the post-experiment Causal Analyst for video streaming. Compare the original hypothesis with the variable actually manipulated. Explain the narrow causal scope, list plausible competing mechanisms, state what remains unproved, and recommend measurements that discriminate those mechanisms. Respect the deterministic guardrail.`;
const leadSystemPrompt = `You are the Lead Experiment Investigator. Synthesize the deterministic guardrail, Evidence Auditor, and Causal Analyst into a clear final evaluation. Lead with what the experiment established, separate interpretation from proof, explain confidence, and propose exactly one small next discriminating test. Never claim that a mechanism was tested when its variable was not manipulated. A causal hypothesis listed under notEstablished is unresolved and must not remain the leading explanation in your wording.`;

function unavailableRuns(limitation: string): ExperimentAgentRun[] {
  return [
    { id: "experiment-evidence-auditor", label: "Evidence Auditor", state: "UNAVAILABLE", limitation },
    { id: "experiment-causal-analyst", label: "Causal Analyst", state: "UNAVAILABLE", limitation },
    { id: "experiment-lead-investigator", label: "Lead Experiment Investigator", state: "UNAVAILABLE", limitation },
  ];
}

function outputSummary(value: unknown): string {
  if (value && typeof value === "object" && "summary" in value && typeof value.summary === "string") return value.summary;
  if (value && typeof value === "object" && "interpretation" in value && typeof value.interpretation === "string") return value.interpretation;
  return "Structured agent output completed.";
}

function summarizeObject(value: Record<string, unknown>): string {
  const preferred = ["summary", "statement", "observation", "comparison", "assessment", "rationale", "description", "measurement", "title", "value", "level"];
  const parts = preferred.flatMap((key) => typeof value[key] === "string" ? [value[key] as string] : []);
  if (parts.length > 0) return [...new Set(parts)].join(" — ").slice(0, 4_000);
  return JSON.stringify(value).slice(0, 4_000);
}

function qualityFromObject(value: Record<string, unknown>): "LOW" | "MEDIUM" | "HIGH" {
  const candidate = [value.level, value.quality, value.confidence, value.rating].find((entry): entry is string => typeof entry === "string")?.toUpperCase();
  return candidate === "HIGH" || candidate === "MEDIUM" || candidate === "LOW" ? candidate : "LOW";
}

function expectedCausalScope(evaluation: ExperimentEvaluation): "TREATMENT_EFFECT_ONLY" | "NO_TREATMENT_EFFECT" | "INCONCLUSIVE" {
  if (evaluation.analysis?.outcome === "DISCRIMINATING_EFFECT") return "TREATMENT_EFFECT_ONLY";
  if (evaluation.analysis?.outcome === "NO_DISCRIMINATING_EFFECT") return "NO_TREATMENT_EFFECT";
  return "INCONCLUSIVE";
}

function withoutCausalScope(value: z.infer<typeof LeadSchema>): ExperimentAgentNarrative {
  const { causalScope: _causalScope, ...narrative } = value;
  return narrative;
}

export type { AuditorOutput, CausalOutput, ExperimentAgentNarrative };
