import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { AiAgentProgress, AiAgentRun, AiFinding, AiInvestigationResult, AgentId, AiPromptAudit } from "../../agents/domain/types.js";
import { createPiModelRunner } from "../../agents/adapters/pi-model-runner.js";
import { runAgentTeam, unavailableResult } from "../../agents/application/run-agent-team.js";
import { parseLeadOutput, parseSpecialistOutput } from "../../agents/domain/parsing.js";
import type { AgentModelRunner } from "../../agents/ports/agent-model-runner.js";
import type { EvidenceBundleV2, EvidenceBundleV3 } from "../domain/evidence.js";
import type { AbrSwitchEvidence } from "../../abr/domain/evidence.js";
import { buildAbrAssessment } from "../../abr/application/assess-stream-abr.js";
import type { AbrAssessment, AbrRepresentation } from "../../abr/domain/assessment.js";
import type { InvestigationLab } from "../ports/investigation-lab.js";
import type { ShellRunRecorder } from "../ports/shell-run-recorder.js";
import type { InvestigationAI } from "../ports/investigation-ai.js";

export { parseLeadOutput, parseSpecialistOutput };
export { PiPromptRevision } from "../../agents/domain/prompts.js";

export class PiInvestigationAI implements InvestigationAI {
  private readonly runner: AgentModelRunner;

  constructor(private readonly config: {
    apiKey?: string;
    provider: string;
    apiUrl: string;
    model: string;
    timeoutMs: number;
    lab?: InvestigationLab;
    shellRunRecorder?: ShellRunRecorder;
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

  async investigate(input: {
    investigationId: string;
    problemDescription?: string;
    evidence: EvidenceBundleV2 | EvidenceBundleV3;
    onProgress?: (update: AiAgentProgress) => Promise<void>;
  }): Promise<AiInvestigationResult> {
    const abrAssessment = ensureAbrAssessment(input.evidence);
    input.evidence.abr = abrAssessment;
    if (!this.config.apiKey) return unavailableResult();
    await collectRequiredSymptomMeasurements(input, this.config.lab, this.config.shellRunRecorder);
    const evidenceIds = new Set(buildEvidenceIndex(input.evidence).map((item) => item.id));
    const packet = JSON.stringify({
      problemDescription: input.problemDescription ?? "No problem was reported; assess the observed stream health.",
      evidence: sanitizeEvidence(input.evidence),
      evidenceIndex: buildEvidenceIndex(input.evidence),
    });
    return runAgentTeam({
      investigationId: input.investigationId,
      protocol: input.evidence.source.protocol,
      provider: this.config.provider,
      model: this.config.model,
      hasLab: Boolean(this.config.lab),
      evidenceIds,
      packet,
      abrAssessment,
      abrTransitions: input.evidence.dash?.switches ?? [],
      onProgress: input.onProgress,
      runModel: this.runner,
      specialistTools: (audit) => createEvidenceTools(input.evidence, undefined, undefined, undefined, createToolCallRecorder(audit)),
      leadTools: (audit) => createEvidenceTools(input.evidence, this.config.lab, input.investigationId, this.config.shellRunRecorder, createToolCallRecorder(audit)),
    });
  }
}

function buildEvidenceIndex(evidence: EvidenceBundleV2 | EvidenceBundleV3): Array<{ id: string; summary: string }> {
  return [
    ...evidence.manifests.map((item) => ({ id: `manifest:${item.logicalKey}`, summary: `${item.kind} ${item.logicalKey}` })),
    ...evidence.mediaSamples.map((item) => ({ id: `sample:${item.logicalKey}`, summary: `${item.kind} ${item.logicalKey}` })),
    ...evidence.observations.map((item, index) => ({ id: `observation:${index}`, summary: item.message })),
    ...(evidence.abr ? [{ id: evidence.abr.evidenceId, summary: `${evidence.abr.protocol.toUpperCase()} ABR assessment: ${evidence.abr.verdict}` }, ...evidence.abr.ladder.representations.map((entry) => ({ id: entry.evidenceId, summary: `ABR quality ${entry.id}` })), ...evidence.abr.findings.map((entry) => ({ id: entry.evidenceId, summary: `${entry.ruleId}: ${entry.title}` })), ...evidence.abr.transitions.map((entry) => ({ id: entry.evidenceId, summary: `${entry.transitionStatus.toLowerCase()} ABR ${entry.sourceRepresentation.id} -> ${entry.targetRepresentation.id}` }))] : []),
    ...(evidence.dash?.switches?.flatMap(abrEvidenceIndex) ?? []),
  ];
}

function sanitizeEvidence(evidence: EvidenceBundleV2 | EvidenceBundleV3): object {
  return {
    protocol: evidence.source.protocol,
    manifests: evidence.manifests.map(({ requestedUrl: _requestedUrl, finalUrl: _finalUrl, ...item }) => item),
    mediaSamples: compactMediaSamples(evidence.mediaSamples),
    observations: evidence.observations,
    limitations: evidence.limitations,
    hls: evidence.hls,
    reportedContext: evidence.reportedContext,
    abr: evidence.abr,
    dash: evidence.dash ? {
      ...evidence.dash,
      switches: evidence.dash.switches?.map((entry) => ({
        evidenceId: entry.evidenceId,
        switchId: entry.switchId,
        evidenceBasis: entry.evidenceBasis,
        transitionStatus: entry.transitionStatus,
        sourceRepresentation: entry.sourceRepresentation,
        targetRepresentation: entry.targetRepresentation,
        direction: entry.direction,
        switchKind: entry.switchKind,
        deterministicFindings: entry.deterministicFindings,
        timelineEvidence: entry.timelineEvidence,
        sapEvidence: entry.sapEvidence,
        initSemanticDiff: entry.initSemanticDiff,
        missingEvidence: entry.missingEvidence,
      })),
    } : undefined,
    ...(evidence.schemaVersion === 3 ? { playbackSessions: evidence.playbackSessions } : {}),
  };
}

function compactMediaSamples(samples: EvidenceBundleV2["mediaSamples"]): object[] {
  const emittedInitHashes = new Set<string>();
  return samples.map((sample) => {
    const init = sample.probe?.fmp4?.init;
    if (!init) return sample;
    const repeated = emittedInitHashes.has(init.sha256);
    emittedInitHashes.add(init.sha256);
    if (!repeated) return sample;
    return {
      ...sample,
      probe: {
        ...sample.probe,
        fmp4: {
          ...sample.probe!.fmp4,
          init: { sha256: init.sha256, fourcc: init.fourcc, timescale: init.timescale, nalLengthSize: init.nalLengthSize, repeatedSemanticInit: true },
        },
      },
    };
  });
}

function ensureAbrAssessment(evidence: EvidenceBundleV2 | EvidenceBundleV3): AbrAssessment {
  if (evidence.abr) return evidence.abr;
  const declaredRepresentations: AbrRepresentation[] = evidence.source.protocol === "dash"
    ? (evidence.dash?.representations ?? []).filter((entry) => entry.contentType === "video").map((entry) => ({ evidenceId: `representation:${entry.id}`, id: entry.id, groupId: `dash:p${entry.periodIndex}:a${entry.adaptationSetIndex}`, ...(entry.bandwidth === undefined ? {} : { bandwidth: entry.bandwidth }), ...(entry.width === undefined ? {} : { width: entry.width }), ...(entry.height === undefined ? {} : { height: entry.height }), ...(entry.codecs ? { codecs: entry.codecs } : {}), segmentCount: entry.segmentCount }))
    : (evidence.hls?.variants ?? []).map((entry) => { const resolution = parseResolution(entry.resolution); return { evidenceId: `hls-variant:${entry.index}`, id: `variant-${entry.index}`, groupId: "hls:video", ...(entry.bandwidth === undefined ? {} : { bandwidth: entry.bandwidth }), ...(entry.averageBandwidth === undefined ? {} : { averageBandwidth: entry.averageBandwidth }), ...(resolution ? resolution : {}), ...(entry.frameRate === undefined ? {} : { frameRate: entry.frameRate }), ...(entry.codecs ? { codecs: entry.codecs } : {}), ...(entry.audioGroupId ? { audioGroupId: entry.audioGroupId } : {}) }; });
  const legacyTransitionRepresentations: AbrRepresentation[] = (evidence.dash?.switches ?? []).flatMap((transition) => [transition.sourceRepresentation, transition.targetRepresentation]).map((entry) => ({ evidenceId: entry.evidenceId, id: entry.id, groupId: `dash:p${entry.periodIndex}:a${entry.adaptationSetIndex}`, ...(entry.bandwidth === undefined ? {} : { bandwidth: entry.bandwidth }), ...(entry.width === undefined ? {} : { width: entry.width }), ...(entry.height === undefined ? {} : { height: entry.height }), ...(entry.codecs ? { codecs: entry.codecs } : {}) }));
  const representations = declaredRepresentations.length > 0 ? declaredRepresentations : [...new Map(legacyTransitionRepresentations.map((entry) => [`${entry.groupId}:${entry.id}`, entry])).values()];
  const context = evidence.reportedContext;
  return buildAbrAssessment({
    protocol: evidence.source.protocol,
    representations,
    audioRenditionCount: evidence.source.protocol === "dash" ? evidence.dash?.representations.filter((entry) => entry.contentType === "audio").length ?? 0 : evidence.hls?.renditions.filter((entry) => entry.type.toUpperCase() === "AUDIO").length ?? 0,
    mediaSampleCount: evidence.mediaSamples.length,
    transitions: evidence.dash?.switches ?? [],
    transitionMatrix: evidence.dash?.switchMatrix ?? [],
    reportedPriority: { abrProblemReported: context?.reportsAbrSwitch ?? false, ...(context?.reportedAbrDirection ? { direction: context.reportedAbrDirection } : {}), ...(context?.reportedResolutionTransition ? { sourceHeight: context.reportedResolutionTransition.sourceHeight, targetHeight: context.reportedResolutionTransition.targetHeight } : {}), ...(context?.approximateTimeSeconds === undefined ? {} : { approximateTimeSeconds: context.approximateTimeSeconds }) },
    coverageLimitations: ["This ABR assessment was reconstructed from a historical evidence bundle."],
  });
}

function abrEvidenceIndex(evidence: AbrSwitchEvidence): Array<{ id: string; summary: string }> {
  const refs: Array<{ id: string; summary: string }> = [
    { id: evidence.evidenceId, summary: `${evidence.transitionStatus.toLowerCase()} ABR ${evidence.sourceRepresentation.id} -> ${evidence.targetRepresentation.id}` },
    { id: evidence.sourceRepresentation.evidenceId, summary: `source Representation ${evidence.sourceRepresentation.id}` },
    { id: evidence.targetRepresentation.evidenceId, summary: `target Representation ${evidence.targetRepresentation.id}` },
    { id: evidence.switchingContract.evidenceId, summary: "MPD switching contract" },
    { id: evidence.networkEvidence.evidenceId, summary: `${evidence.evidenceBasis === "URL_STATIC_ANALYSIS" ? "investigation fetch" : "playback request"} summary` },
    ...evidence.networkEvidence.requests.map((item) => ({ id: item.evidenceId, summary: `${item.captureSource.toLowerCase()} ${item.resourceKind}` })),
    ...optionalAbrRef(evidence.reportedPlayerContext, "user-reported player context"),
    ...optionalAbrRef(evidence.sourceInit, "source INIT"),
    ...optionalAbrRef(evidence.targetInit, "target INIT"),
    ...optionalAbrRef(evidence.initSemanticDiff, "semantic INIT diff"),
    ...optionalAbrRef(evidence.codecDiff, "HEVC parameter-set diff"),
    ...optionalAbrRef(evidence.sapEvidence, "target SAP/IRAP evidence"),
    ...optionalAbrRef(evidence.timelineEvidence, "normalized boundary timeline"),
    ...optionalAbrRef(evidence.deviceCapabilityEvidence, "device capability evidence"),
    ...optionalAbrRef(evidence.playerEvidence, "player event evidence"),
    ...optionalAbrRef(evidence.conformance, "DASH-IF conformance summary"),
    ...boundaryRefs(evidence.sourceBoundary, "source boundary"),
    ...boundaryRefs(evidence.targetBoundary, "target boundary"),
    ...evidence.decodeTests.map((item) => ({ id: item.evidenceId, summary: `${item.test} decode test` })),
    ...evidence.deterministicFindings.map((item) => ({ id: item.evidenceId, summary: `${item.ruleId}: ${item.title}` })),
  ];
  return [...new Map(refs.map((entry) => [entry.id, entry])).values()];
}

function optionalAbrRef(value: { evidenceId: string } | undefined, summary: string): Array<{ id: string; summary: string }> { return value ? [{ id: value.evidenceId, summary }] : []; }
function boundaryRefs(value: AbrSwitchEvidence["targetBoundary"], summary: string): Array<{ id: string; summary: string }> { return value ? [{ id: value.evidenceId, summary }, ...value.accessUnits.map((item) => ({ id: item.evidenceId, summary: `${summary} access unit ${item.index}` }))] : []; }
function parseResolution(value: string | undefined): { width: number; height: number } | undefined { const match = /^(\d+)x(\d+)$/i.exec(value ?? ""); return match ? { width: Number(match[1]), height: Number(match[2]) } : undefined; }

/** Specialists inspect saved facts; only the Lead receives the separate lab shell. */
function createEvidenceTools(
  evidence: EvidenceBundleV2 | EvidenceBundleV3,
  lab?: InvestigationLab,
  investigationId?: string,
  shellRunRecorder?: ShellRunRecorder,
  recordToolCall?: (call: { name: string; input: string; output: string }) => void,
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
      const result = {
        logicalKey: sample.logicalKey,
        kind: sample.kind,
        sizeBytes: sample.sizeBytes,
        declaredDuration: sample.declaredDuration,
        sequence: sample.sequence,
        probe: sample.probe,
      };
      const output = JSON.stringify(result);
      const response = { content: [{ type: "text" as const, text: output }], details: { logicalKey: sample.logicalKey } };
      recordToolCall?.({ name: "inspect_preserved_sample", input: JSON.stringify(params), output });
      return response;
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
      const output = JSON.stringify({ evidenceId, ...result });
      const response = {
        content: [{ type: "text" as const, text: output }],
        details: { evidenceId, command: value.command, exitCode: result.exitCode, timedOut: result.timedOut },
      };
      recordToolCall?.({ name: "shell_exec", input: JSON.stringify(params), output });
      return response;
    },
  });
  return tools;
}

function createToolCallRecorder(audit: AiPromptAudit): (call: { name: string; input: string; output: string }) => void {
  return (call) => audit.toolCalls.push(call);
}

function shellMeasurementMessage(
  command: string,
  result: Awaited<ReturnType<InvestigationLab["execute"]>>,
  shellRunId?: string,
): string {
  const output = `${result.stdout}\n${result.stderr}`.replace(/\s+/g, " ").trim().slice(0, 1_500);
  return `Shell measurement completed${shellRunId ? ` (shellRunId=${shellRunId})` : ""} (exit=${result.exitCode ?? "null"}, timedOut=${result.timedOut}, durationMs=${result.durationMs}, command=${command.slice(0, 240)}). ${output || "No output."}`;
}

const FREEZE_DETECTION_COMMAND = "ffmpeg -hide_banner -nostdin -loglevel info -protocol_whitelist file,crypto,data -i ../input/index.m3u8 -map 0:v:0 -vf freezedetect=n=-50dB:d=0.4 -an -f null -";

async function collectRequiredSymptomMeasurements(
  input: { investigationId: string; problemDescription?: string; evidence: EvidenceBundleV2 | EvidenceBundleV3 },
  lab?: InvestigationLab,
  shellRunRecorder?: ShellRunRecorder,
): Promise<void> {
  if (input.evidence.source.protocol !== "hls") return;
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

export type { AgentId, AiAgentRun, AiFinding };
