import { createHash } from "node:crypto";
import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";
import { getModel, streamSimple } from "@earendil-works/pi-ai/compat";
import { Type } from "typebox";
import { z } from "zod";
import { logger } from "../../infra/logger.js";
import type { EvidenceBundleV2, EvidenceBundleV3 } from "../domain/evidence.js";
import type { InvestigationLab } from "../ports/investigation-lab.js";
import type { ShellRunRecorder } from "../ports/shell-run-recorder.js";
import type { AiAgentProgress, AiAgentRun, AiFinding, AiInvestigationResult, InvestigationAI } from "../ports/investigation-ai.js";

const LIMITED_CONFIDENCE = 0.2;
const ConfidenceSchema = z.preprocess(normalizeConfidence, z.number().min(0).max(1));
const SeveritySchema = z.preprocess(normalizeSeverity, z.enum(["info", "warning", "error"]));
const FindingSchema = z.object({
  title: z.string().trim().min(1),
  severity: SeveritySchema,
  explanation: z.string().trim().min(1),
  evidenceIds: z.preprocess(
    (value) => typeof value === "string" ? [value] : value,
    z.array(z.string().trim().min(1)),
  ),
  confidence: ConfidenceSchema,
});
const SpecialistEnvelopeSchema = z.object({
  summary: z.string().min(1),
  findings: z.array(z.unknown()).default([]),
  limitations: z.array(z.string()).default([]),
});
const LeadEnvelopeSchema = SpecialistEnvelopeSchema.extend({
  likelyCause: z.string().min(1),
  recommendations: z.array(z.string()).default([]),
  confidence: ConfidenceSchema,
});
type SpecialistOutput = {
  summary: string;
  findings: AiFinding[];
  limitations: string[];
};
type LeadOutput = SpecialistOutput & {
  likelyCause: string;
  recommendations: string[];
  confidence: number;
};
type SuccessfulSpecialist = { id: (typeof profiles)[number]["id"]; output: SpecialistOutput };
type AgentId = AiAgentRun["id"];

const profiles = [
  { id: "timeline-playback", label: "Timeline & Playback", focus: "PTS/DTS continuity, A/V alignment, discontinuities and playback impact." },
  { id: "container-encoding", label: "Container & Encoding", focus: "MPEG-TS container, observed codecs, tracks, durations and keyframe evidence." },
  { id: "manifest-delivery", label: "Manifest & Delivery", focus: "HLS topology, selection, declared versus observed media properties and limitations." },
] as const;

export class PiInvestigationAI implements InvestigationAI {
  constructor(private readonly config: { apiKey?: string; provider: string; apiUrl: string; model: string; timeoutMs: number; lab?: InvestigationLab; shellRunRecorder?: ShellRunRecorder }) {}

  async investigate(input: {
    investigationId: string;
    problemDescription?: string;
    evidence: EvidenceBundleV2 | EvidenceBundleV3;
    onProgress?: (update: AiAgentProgress) => Promise<void>;
  }): Promise<AiInvestigationResult> {
    if (!this.config.apiKey) return unavailableResult();
    await collectRequiredSymptomMeasurements(input, this.config.lab, this.config.shellRunRecorder);
    const evidenceIds = new Set(buildEvidenceIndex(input.evidence).map((item) => item.id));
    const packet = JSON.stringify({
      problemDescription: input.problemDescription ?? "No problem was reported; assess the observed stream health.",
      evidence: sanitizeEvidence(input.evidence),
      evidenceIndex: buildEvidenceIndex(input.evidence),
    });
    const agentRuns: AiAgentRun[] = [];
    const totalRuns = profiles.length + 1;
    const reportProgress = async (update: Pick<AiAgentProgress, "agent" | "stage" | "limitation">): Promise<void> => {
      if (!input.onProgress) return;
      try {
        await input.onProgress({ ...update, completed: agentRuns.length, total: totalRuns });
      } catch (error) {
        logger.warn("ai.progress_callback_failed", {
          investigationId: input.investigationId,
          agentId: update.agent,
          errorType: error instanceof Error ? error.name : "unknown",
        });
      }
    };
    const specialistOutputs: Array<SuccessfulSpecialist | undefined> = await Promise.all(profiles.map(async (profile) => {
      await reportProgress({ agent: profile.id, stage: "started" });
      try {
        const output = await this.runStructured(
          input.investigationId,
          profile.id,
          specialistPrompt(profile.label, profile.focus),
          packet,
          parseSpecialistOutput,
          createEvidenceTools(input.evidence),
        );
        agentRuns.push({ id: profile.id, state: "completed", summary: output.summary });
        await reportProgress({ agent: profile.id, stage: "completed" });
        return { id: profile.id, output: filterSpecialist(output, evidenceIds) } as SuccessfulSpecialist;
      } catch (error) {
        const limitation = publicError(error);
        agentRuns.push({ id: profile.id, state: "failed", limitation });
        await reportProgress({ agent: profile.id, stage: "failed", limitation });
        return undefined;
      }
    }));
    const completed = specialistOutputs.filter((item): item is SuccessfulSpecialist => item !== undefined);
    if (completed.length === 0) return { available: true, findings: [], recommendations: [], limitations: ["All AI specialists failed; deterministic evidence remains available."], agents: agentRuns };
    await reportProgress({ agent: "lead-investigator", stage: "started" });
    try {
      const lead = await this.runStructured(
        input.investigationId,
        "lead-investigator",
        leadPrompt(Boolean(this.config.lab)),
        JSON.stringify({ packet: JSON.parse(packet), specialists: completed }),
        parseLeadOutput,
        createEvidenceTools(input.evidence, this.config.lab, input.investigationId, this.config.shellRunRecorder),
      );
      const filtered = filterSpecialist(lead, new Set(buildEvidenceIndex(input.evidence).map((item) => item.id)));
      agentRuns.push({ id: "lead-investigator", state: "completed", summary: lead.summary });
      await reportProgress({ agent: "lead-investigator", stage: "completed" });
      return {
        available: true, summary: lead.summary, likelyCause: lead.likelyCause, confidence: capConfidence(lead.confidence, filtered.findings),
        findings: filtered.findings, recommendations: lead.recommendations.slice(0, 6), limitations: filtered.limitations, agents: agentRuns,
      };
    } catch (error) {
      const limitation = publicError(error);
      agentRuns.push({ id: "lead-investigator", state: "failed", limitation });
      await reportProgress({ agent: "lead-investigator", stage: "failed", limitation });
      const findings = completed.flatMap((item) => item.output.findings);
      return { available: true, findings, recommendations: [], limitations: ["Lead synthesis failed; specialist findings are shown directly."], agents: agentRuns };
    }
  }

  private async runJson(
    investigationId: string,
    agentId: AgentId,
    attempt: number,
    systemPrompt: string,
    prompt: string,
    tools: AgentTool[],
  ): Promise<unknown> {
    const discovered = getModel(this.config.provider as never, this.config.model);
    const model = discovered ? { ...discovered, baseUrl: normalizeBaseUrl(this.config.apiUrl) } : undefined;
    if (!model) throw new Error("Configured Pi model is unavailable");
    const agent = new Agent({
      initialState: { systemPrompt, model, thinkingLevel: "low", tools, messages: [] },
      streamFn: streamSimple,
      getApiKey: () => this.config.apiKey!,
      onResponse: (response) => {
        logger.info("ai.provider_response", {
          investigationId,
          agentId,
          attempt,
          provider: this.config.provider,
          model: this.config.model,
          status: response.status,
        });
      },
    });
    let timeout: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        new Promise<unknown>((resolve, reject) => {
          let unsubscribe: (() => void) | undefined;
          let settled = false;
          const finish = (callback: () => void): void => {
            if (settled) return;
            settled = true;
            unsubscribe?.();
            callback();
          };
          const value = agent.subscribe((event) => {
            const typed = event as {
              type?: string;
              messages?: Array<{ role?: string; content?: unknown; errorMessage?: string }>;
            };
            if (typed.type !== "agent_end") return;
            const messages = typed.messages ?? agent.state.messages;
            const message = [...messages].reverse().find((item) => item.role === "assistant");
            if (message && "errorMessage" in message && message.errorMessage) {
              finish(() => reject(new Error("Pi provider returned an unsuccessful response")));
              return;
            }
            const text = extractText(message && "content" in message ? message.content : undefined);
            if (!text) finish(() => reject(new Error("Pi returned empty content")));
            else finish(() => resolve(JSON.parse(extractJson(text))));
          });
          if (typeof value === "function") unsubscribe = value;
          agent.prompt(prompt).catch((error) => finish(() => reject(error)));
        }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            agent.abort();
            reject(new Error("Pi investigation timed out"));
          }, this.config.timeoutMs);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private async runStructured<T>(
    investigationId: string,
    agentId: AgentId,
    systemPrompt: string,
    prompt: string,
    parse: (value: unknown) => T,
    tools: AgentTool[],
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const startedAt = Date.now();
      logger.info("ai.agent_attempt_started", {
        investigationId,
        agentId,
        attempt: attempt + 1,
        provider: this.config.provider,
        model: this.config.model,
      });
      try {
        const retryInstruction = attempt === 0
          ? ""
          : "\nThis is a contract-correction retry. Check every required field and return one valid JSON object only.";
        const output = parse(await this.runJson(
          investigationId,
          agentId,
          attempt + 1,
          systemPrompt,
          `${prompt}${retryInstruction}`,
          tools,
        ));
        logger.info("ai.agent_attempt_completed", {
          investigationId,
          agentId,
          attempt: attempt + 1,
          durationMs: Date.now() - startedAt,
        });
        return output;
      } catch (error) {
        lastError = error;
        logger.warn("ai.agent_attempt_failed", {
          investigationId,
          agentId,
          attempt: attempt + 1,
          durationMs: Date.now() - startedAt,
          errorType: classifyAiError(error),
        });
      }
    }
    throw lastError;
  }
}

function specialistPrompt(label: string, focus: string): string {
  return `You are the ${label} specialist for an HLS MPEG-TS investigation. ${focus}
Use only evidence IDs present in the supplied evidenceIndex. Do not invent measurements or causal facts.
When a preserved sample needs closer inspection, you may call inspect_preserved_sample with its exact logical key. This tool only returns stored probe facts; do not request URLs, commands or arbitrary files.
Return exactly one JSON object without markdown:
{"summary":"string","findings":[{"title":"string","severity":"info|warning|error","explanation":"string","evidenceIds":["exact evidence ID"],"confidence":0.5}],"limitations":["string"]}
Every confidence MUST be a finite JSON number between 0 and 1, never a string, null, NaN or Infinity. When confidence cannot be assessed, use 0.2 and explain why in limitations. Findings may be empty when the evidence does not support a claim.`;
}
function leadPrompt(hasLab: boolean): string {
  return `You are the Lead Investigator. Synthesize the specialist reports and deterministic HLS MPEG-TS evidence.
The initial packet is a starting point, not a stopping condition. If it does not confirm or rule out the reported symptom, you MUST use the available investigation tools to obtain a relevant additional measurement before returning an inconclusive result. Do not merely list an unmeasured cause as a possibility.
Every finding must cite exact IDs present in evidenceIndex.
You may inspect an already preserved sample through inspect_preserved_sample; it cannot fetch or execute anything.
${hasLab ? "You also have shell_exec: it is a real shell in an isolated local media lab. Input HLS is ../input/index.m3u8 relative to the shell working directory. It has no network or secrets. Use it whenever the initial evidence is inconclusive for the reported symptom. Examples: visual freeze/repeated frames -> ffmpeg -hide_banner -nostdin -loglevel info -i ../input/index.m3u8 -map 0:v:0 -vf freezedetect=n=-50dB:d=0.4 -an -f null -; black video -> blackdetect; silence/audio dropout -> silencedetect; decode suspicion -> ffmpeg decode to null with error logging; timing/keyframe suspicion -> ffprobe frame or packet analysis. Select only measurements relevant to the symptom. Each shell result returns an evidenceId; cite it in any supported finding." : "No media lab is available in this run; state the resulting limitation rather than inventing a measurement."}
Return exactly one JSON object without markdown:
{"summary":"string","likelyCause":"string","confidence":0.5,"findings":[{"title":"string","severity":"info|warning|error","explanation":"string","evidenceIds":["exact evidence ID"],"confidence":0.5}],"recommendations":["string"],"limitations":["string"]}
Every confidence MUST be a finite JSON number between 0 and 1, never a string, null, NaN or Infinity. When confidence cannot be assessed, use 0.2.`;
}
function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((part) => typeof part === "object" && part && "text" in part ? [String((part as { text: unknown }).text)] : []).join("\n");
}
function extractJson(text: string): string { const first = text.indexOf("{"); const last = text.lastIndexOf("}"); if (first < 0 || last <= first) throw new Error("Pi response did not contain JSON"); return text.slice(first, last + 1); }
export function parseSpecialistOutput(value: unknown): SpecialistOutput {
  const output = SpecialistEnvelopeSchema.parse(value);
  return {
    summary: output.summary,
    findings: parseFindings(output.findings),
    limitations: output.limitations,
  };
}
export function parseLeadOutput(value: unknown): LeadOutput {
  const output = LeadEnvelopeSchema.parse(value);
  return {
    summary: output.summary,
    likelyCause: output.likelyCause,
    confidence: output.confidence,
    findings: parseFindings(output.findings),
    recommendations: output.recommendations,
    limitations: output.limitations,
  };
}
function parseFindings(values: unknown[]): AiFinding[] {
  return values.flatMap((value) => {
    const parsed = FindingSchema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  });
}
function buildEvidenceIndex(evidence: EvidenceBundleV2 | EvidenceBundleV3): Array<{ id: string; summary: string }> {
  return [
    ...evidence.manifests.map((item) => ({ id: `manifest:${item.logicalKey}`, summary: `${item.kind} ${item.logicalKey}` })),
    ...evidence.mediaSamples.map((item) => ({ id: `sample:${item.logicalKey}`, summary: `${item.kind} ${item.logicalKey}` })),
    ...evidence.observations.map((item, index) => ({ id: `observation:${index}`, summary: item.message })),
  ];
}
function sanitizeEvidence(evidence: EvidenceBundleV2 | EvidenceBundleV3): object {
  return { protocol: evidence.source.protocol, manifests: evidence.manifests.map(({ requestedUrl: _requestedUrl, finalUrl: _finalUrl, ...item }) => item), mediaSamples: evidence.mediaSamples, observations: evidence.observations, limitations: evidence.limitations, hls: evidence.hls, ...(evidence.schemaVersion === 3 ? { playbackSessions: evidence.playbackSessions } : {}) };
}
/** Specialists inspect saved facts; only the Lead receives the separate lab shell. */
function createEvidenceTools(
  evidence: EvidenceBundleV2 | EvidenceBundleV3,
  lab?: InvestigationLab,
  investigationId?: string,
  shellRunRecorder?: ShellRunRecorder,
): AgentTool[] {
  const samples = new Map(evidence.mediaSamples.map((sample) => [sample.logicalKey, sample]));
  const tools: AgentTool[] = [{
    name: "inspect_preserved_sample",
    label: "Inspect preserved media sample",
    description: "Return the deterministic probe facts for one sample logical key from the evidence index. No network or media process is started.",
    parameters: Type.Object({ logicalKey: Type.String({ minLength: 1, maxLength: 180 }) }),
    executionMode: "sequential",
    execute: async (_toolCallId, params) => {
      const logicalKey = (params as { logicalKey: string }).logicalKey;
      const sample = samples.get(logicalKey);
      if (!sample) throw new Error("The requested sample is not part of this investigation evidence");
      const result = { logicalKey: sample.logicalKey, kind: sample.kind, sizeBytes: sample.sizeBytes, declaredDuration: sample.declaredDuration, sequence: sample.sequence, probe: sample.probe };
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: { logicalKey: sample.logicalKey } };
    },
  }];
  if (!lab || !investigationId) return tools;
  tools.push({
    name: "shell_exec",
    label: "Run a command in the investigation lab",
    description: "Run bash in an isolated local media workspace. It has FFmpeg, FFprobe, MediaInfo, jq and Python, but no network, secrets or host filesystem. Input HLS is ../input/index.m3u8. The returned evidenceId must be cited when it supports a finding.",
    parameters: Type.Object({
      command: Type.String({ minLength: 1, maxLength: 12_000 }),
      timeoutMs: Type.Optional(Type.Number({ minimum: 1_000, maximum: 120_000 })),
    }),
    executionMode: "sequential",
    execute: async (_toolCallId, params) => {
      const value = params as { command: string; timeoutMs?: number };
      const result = await lab.execute({
        investigationId,
        command: value.command,
        ...(value.timeoutMs === undefined ? {} : { timeoutMs: value.timeoutMs }),
      });
      const shellRunId = shellRunRecorder
        ? await shellRunRecorder.record({ investigationId, command: value.command, result }).catch(() => undefined)
        : undefined;
      const evidenceId = `observation:${evidence.observations.length}`;
      evidence.observations.push({
        code: "SHELL_MEASUREMENT",
        severity: result.exitCode === 0 && !result.timedOut ? "info" : "warning",
        message: shellMeasurementMessage(value.command, result, shellRunId),
      });
      return {
        content: [{ type: "text", text: JSON.stringify({ evidenceId, ...result }) }],
        details: { evidenceId, command: value.command, exitCode: result.exitCode, timedOut: result.timedOut },
      };
    },
  });
  return tools;
}

function shellMeasurementMessage(command: string, result: Awaited<ReturnType<InvestigationLab["execute"]>>, shellRunId?: string): string {
  const output = `${result.stdout}\n${result.stderr}`.replace(/\s+/g, " ").trim().slice(0, 1_500);
  return `Shell measurement completed${shellRunId ? ` (shellRunId=${shellRunId})` : ""} (exit=${result.exitCode ?? "null"}, timedOut=${result.timedOut}, durationMs=${result.durationMs}, command=${command.slice(0, 240)}). ${output || "No output."}`;
}

const FREEZE_DETECTION_COMMAND = "ffmpeg -hide_banner -nostdin -loglevel info -protocol_whitelist file,crypto,data -i ../input/index.m3u8 -map 0:v:0 -vf freezedetect=n=-50dB:d=0.4 -an -f null -";

async function collectRequiredSymptomMeasurements(
  input: { investigationId: string; problemDescription?: string; evidence: EvidenceBundleV2 | EvidenceBundleV3 },
  lab?: InvestigationLab,
  shellRunRecorder?: ShellRunRecorder,
): Promise<void> {
  if (!lab || !requiresFreezeDetection(input.problemDescription)) return;
  try {
    const result = await lab.execute({ investigationId: input.investigationId, command: FREEZE_DETECTION_COMMAND, timeoutMs: 120_000 });
    const shellRunId = shellRunRecorder
      ? await shellRunRecorder.record({ investigationId: input.investigationId, command: FREEZE_DETECTION_COMMAND, result }).catch(() => undefined)
      : undefined;
    input.evidence.observations.push({
      code: "FREEZE_DETECTION",
      severity: result.exitCode === 0 && !result.timedOut ? "info" : "warning",
      message: shellMeasurementMessage(FREEZE_DETECTION_COMMAND, result, shellRunId),
    });
  } catch (error) {
    input.evidence.observations.push({
      code: "FREEZE_DETECTION_UNAVAILABLE",
      severity: "warning",
      message: `Required freeze detection could not run: ${error instanceof Error ? error.message : "unknown lab error"}.`,
    });
  }
}

function requiresFreezeDetection(problemDescription?: string): boolean {
  return /(?:freeze|frozen|freezing|congel|trav(?:a|ou|ando)|imagem\s+(?:parada|congelada)|frames?\s+(?:repetid|duplicad))/iu.test(problemDescription ?? "");
}
function filterSpecialist(output: SpecialistOutput, valid: Set<string>): SpecialistOutput {
  return { ...output, findings: output.findings.map((finding) => ({ ...finding, evidenceIds: finding.evidenceIds.filter((id) => valid.has(id)) })).filter((finding) => finding.evidenceIds.length > 0), limitations: output.limitations.slice(0, 8) };
}
function capConfidence(value: number, findings: AiFinding[]): number { return findings.length === 0 ? 0.2 : Math.min(value, 0.75); }
function normalizeConfidence(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 && value <= 1 ? value : LIMITED_CONFIDENCE;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : LIMITED_CONFIDENCE;
  }
  return LIMITED_CONFIDENCE;
}
function normalizeSeverity(value: unknown): "info" | "warning" | "error" {
  if (typeof value !== "string") return "info";
  const normalized = value.trim().toLowerCase();
  if (["error", "critical", "high"].includes(normalized)) return "error";
  if (["warning", "warn", "medium"].includes(normalized)) return "warning";
  return "info";
}
function classifyAiError(error: unknown): string {
  if (error instanceof z.ZodError) return "response_validation";
  if (error instanceof SyntaxError) return "invalid_json";
  if (error instanceof Error && error.message.includes("timed out")) return "timeout";
  if (error instanceof Error && error.message.includes("empty content")) return "empty_content";
  if (error instanceof Error && error.message.includes("unavailable")) return "model_unavailable";
  if (typeof error === "object" && error && "status" in error && typeof error.status === "number") {
    return `provider_http_${error.status}`;
  }
  return "provider_error";
}
function publicError(error: unknown): string {
  const errorType = classifyAiError(error);
  if (errorType === "response_validation" || errorType === "invalid_json" || errorType === "empty_content") {
    return "The AI response did not satisfy the structured analysis contract after retry.";
  }
  if (errorType === "timeout") return "The AI analysis timed out after retry.";
  if (errorType === "model_unavailable") return "The configured AI model is unavailable.";
  return "The AI provider request failed after retry.";
}
function unavailableResult(): AiInvestigationResult { return { available: false, findings: [], recommendations: [], limitations: ["AI analysis is unavailable because no provider API key is configured."], agents: [...profiles.map((profile) => ({ id: profile.id, state: "unavailable" as const })), { id: "lead-investigator", state: "unavailable" as const }] }; }
function normalizeBaseUrl(value: string): string { return value.replace(/\/chat\/completions\/?$/, "").replace(/\/$/, ""); }
export const PiPromptRevision = createHash("sha256").update(`${specialistPrompt("x", "x")}${leadPrompt(true)}`).digest("hex").slice(0, 12);
