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
    const evidenceIndex = buildEvidenceIndex(input.evidence);
    const evidenceIds = new Set(evidenceIndex.map((item) => item.id));
    const problemDescription = input.problemDescription ?? "No problem was reported; assess the observed stream health.";
    const deterministicAbrSummary = abrSummaryForPacket(input.evidence.abr);
    const packet = JSON.stringify({
      problemDescription,
      evidence: leadEvidence(input.evidence),
      evidenceIndex,
      ...(deterministicAbrSummary ? { deterministicAbrSummary } : {}),
    });
    return runAgentTeam({
      investigationId: input.investigationId,
      protocol: input.evidence.source.protocol,
      provider: this.config.provider,
      model: this.config.model,
      hasLab: Boolean(this.config.lab),
      evidenceIds,
      packet,
      specialistPackets: {
        "timeline-playback": specialistPacket(problemDescription, timelineLaneEvidence(input.evidence), laneEvidenceIndex(evidenceIndex, ["timeline:", "sample:"]), deterministicAbrSummary),
        "container-encoding": specialistPacket(problemDescription, containerLaneEvidence(input.evidence), laneEvidenceIndex(evidenceIndex, ["sample:"]), deterministicAbrSummary),
        "manifest-delivery": specialistPacket(problemDescription, manifestLaneEvidence(input.evidence), laneEvidenceIndex(evidenceIndex, ["manifest:"]), deterministicAbrSummary),
      },
      abrAssessment,
      abrTransitions: [...(input.evidence.dash?.switches ?? []), ...(input.evidence.playbackSwitches ?? [])],
      onProgress: input.onProgress,
      runModel: this.runner,
      specialistTools: (audit) => createEvidenceTools(input.evidence, undefined, undefined, undefined, createToolCallRecorder(audit)),
      leadTools: (audit) => createEvidenceTools(input.evidence, this.config.lab, input.investigationId, this.config.shellRunRecorder, createToolCallRecorder(audit)),
    });
  }
}

function specialistPacket(
  problemDescription: string,
  evidence: object,
  evidenceIndex: Array<{ id: string; summary: string }>,
  abrSummary: object | undefined,
): { prompt: string; evidenceIds: string[] } {
  return {
    prompt: JSON.stringify({
    problemDescription,
    evidence,
    evidenceIndex,
    ...(abrSummary ? { deterministicAbrSummary: abrSummary } : {}),
    }),
    evidenceIds: evidenceIndex.map((item) => item.id),
  };
}

function laneEvidenceIndex(
  evidenceIndex: Array<{ id: string; summary: string }>,
  prefixes: readonly string[],
): Array<{ id: string; summary: string }> {
  return evidenceIndex.filter((item) => prefixes.some((prefix) => item.id.startsWith(prefix)));
}

/** Compact anti-echo context: what the deterministic ABR pass already stated,
 * so specialists do not spend tokens retelling ladder findings. */
function abrSummaryForPacket(abr: AbrAssessment | undefined): object | undefined {
  if (!abr) return undefined;
  return {
    evidenceId: abr.evidenceId,
    protocol: abr.protocol,
    verdict: abr.verdict,
    coverage: abr.coverage.level,
    findings: abr.findings.map((finding) => ({
      ruleId: finding.ruleId,
      severity: finding.severity,
      title: finding.title,
      evidenceId: finding.evidenceId,
    })),
  };
}

function manifestIndex(evidence: EvidenceBundleV2 | EvidenceBundleV3, options: { timingTags?: boolean } = {}): object[] {
  return evidence.manifests.map((manifest) => ({
    logicalKey: manifest.logicalKey,
    kind: manifest.kind,
    role: manifest.role,
    ...(manifest.segmentCount === undefined ? {} : { segmentCount: manifest.segmentCount }),
    ...(manifest.targetDuration === undefined ? {} : { targetDuration: manifest.targetDuration }),
    ...(manifest.discontinuityCount === undefined ? {} : { discontinuityCount: manifest.discontinuityCount }),
    ...(options.timingTags ? {
      ...(manifest.mediaSequence === undefined ? {} : { mediaSequence: manifest.mediaSequence }),
      ...(manifest.discontinuitySequence === undefined ? {} : { discontinuitySequence: manifest.discontinuitySequence }),
      ...(manifest.hasEndList === undefined ? {} : { hasEndList: manifest.hasEndList }),
    } : {}),
  }));
}

/** Timeline & Playback lane: timing facts only. */
function timelineLaneEvidence(evidence: EvidenceBundleV2 | EvidenceBundleV3): object {
  return {
    protocol: evidence.source.protocol,
    manifests: manifestIndex(evidence, { timingTags: true }),
    mediaSamples: evidence.mediaSamples.map(timingOnlySample),
    ...(evidence.timeline?.length ? { timeline: evidence.timeline } : {}),
    limitations: evidence.limitations,
    reportedContext: evidence.reportedContext,
    ...(evidence.hls?.selection ? { hlsSelection: evidence.hls.selection } : {}),
    ...(evidence.playbackSwitches?.length ? { playbackSwitches: evidence.playbackSwitches.map(sanitizeAbrSwitch) } : {}),
  };
}

function timingOnlySample(sample: EvidenceBundleV2["mediaSamples"][number]): object {
  const fragment = sample.probe?.fmp4?.fragment;
  return {
    logicalKey: sample.logicalKey,
    kind: sample.kind,
    ...(sample.sourceManifestLogicalKey ? { sourceManifestLogicalKey: sample.sourceManifestLogicalKey } : {}),
    ...(sample.sampleIndex === undefined ? {} : { sampleIndex: sample.sampleIndex }),
    ...(sample.sequence === undefined ? {} : { sequence: sample.sequence }),
    ...(sample.declaredDuration === undefined ? {} : { declaredDuration: sample.declaredDuration }),
    ...(sample.representationId === undefined ? {} : { representationId: sample.representationId }),
    ...(sample.presentationStartSeconds === undefined ? {} : { presentationStartSeconds: sample.presentationStartSeconds }),
    ...(sample.presentationEndSeconds === undefined ? {} : { presentationEndSeconds: sample.presentationEndSeconds }),
    ...(sample.probe ? { probe: {
      ...(sample.probe.format ? { format: sample.probe.format } : {}),
      ...(sample.probe.duration === undefined ? {} : { duration: sample.probe.duration }),
      tracks: (sample.probe.tracks ?? []).map((track) => ({
        kind: track.kind,
        ...(track.codec ? { codec: track.codec } : {}),
        ...(track.duration === undefined ? {} : { duration: track.duration }),
        ...(track.firstPts === undefined ? {} : { firstPts: track.firstPts }),
        ...(track.lastPts === undefined ? {} : { lastPts: track.lastPts }),
        ...(track.sampleRate === undefined ? {} : { sampleRate: track.sampleRate }),
        ...(track.channels === undefined ? {} : { channels: track.channels }),
      })),
      ...(fragment ? { fmp4: { fragment: {
        ...(fragment.styp ? { styp: fragment.styp } : {}),
        ...(fragment.sidx ? { sidx: fragment.sidx } : {}),
        ...(fragment.sequenceNumber === undefined ? {} : { sequenceNumber: fragment.sequenceNumber }),
        ...(fragment.baseMediaDecodeTime ? { baseMediaDecodeTime: fragment.baseMediaDecodeTime } : {}),
        sampleCount: fragment.samples.length,
        syncSampleCount: fragment.samples.filter((entry) => entry.sync).length,
      } } } : {}),
    } } : {}),
  };
}

/** Container & Encoding lane: probes only, no ladder topology or delivery. */
function containerLaneEvidence(evidence: EvidenceBundleV2 | EvidenceBundleV3): object {
  return {
    protocol: evidence.source.protocol,
    mediaSamples: compactMediaSamples(evidence.mediaSamples),
    limitations: evidence.limitations,
  };
}

/** Manifest & Delivery lane: raw manifest text, HTTP facts and declared
 * topology; media appears only as a compact sample index. */
function manifestLaneEvidence(evidence: EvidenceBundleV2 | EvidenceBundleV3): object {
  return {
    protocol: evidence.source.protocol,
    manifests: evidence.manifests.map((manifest) => {
      const { requestedUrl: _requestedUrl, finalUrl: _finalUrl, artifactId: _artifactId, sha256: _sha256, ...item } = manifest;
      return item;
    }),
    mediaSampleIndex: evidence.mediaSamples.map((sample) => ({
      logicalKey: sample.logicalKey,
      kind: sample.kind,
      ...(sample.sourceManifestLogicalKey ? { sourceManifestLogicalKey: sample.sourceManifestLogicalKey } : {}),
      ...(sample.sequence === undefined ? {} : { sequence: sample.sequence }),
      ...(sample.declaredDuration === undefined ? {} : { declaredDuration: sample.declaredDuration }),
      ...(sample.representationId === undefined ? {} : { representationId: sample.representationId }),
    })),
    limitations: evidence.limitations,
    ...(evidence.hls ? { hls: sanitizedHls(evidence.hls) } : {}),
    ...(evidence.dash ? { dash: {
      type: evidence.dash.type,
      representations: evidence.dash.representations.map(({
        baseUrl: _baseUrl,
        initializationUrl: _initializationUrl,
        mediaTemplate: _mediaTemplate,
        contentProtection: _contentProtection,
        ...representation
      }) => representation),
      ...(evidence.dash.switchMatrix?.length ? { switchMatrix: evidence.dash.switchMatrix } : {}),
      limitations: evidence.dash.limitations,
    } } : {}),
  };
}

function buildEvidenceIndex(evidence: EvidenceBundleV2 | EvidenceBundleV3): Array<{ id: string; summary: string }> {
  return [
    ...evidence.manifests.map((item) => ({ id: `manifest:${item.logicalKey}`, summary: `${item.kind} ${item.logicalKey}` })),
    ...evidence.mediaSamples.map((item) => ({ id: `sample:${item.logicalKey}`, summary: `${item.kind} ${item.logicalKey}` })),
    ...evidence.observations.map((item, index) => ({ id: `observation:${index}`, summary: item.message })),
    ...(evidence.timeline?.map((window) => ({ id: `timeline:${window.key}`, summary: `${window.kind} timeline ${window.key}: ${window.segmentCount} segments, ${window.totalGapMs}ms total gap, continuous=${window.continuous}` })) ?? []),
    ...(evidence.abr ? [{ id: evidence.abr.evidenceId, summary: `${evidence.abr.protocol.toUpperCase()} ABR assessment: ${evidence.abr.verdict}` }, ...evidence.abr.ladder.representations.map((entry) => ({ id: entry.evidenceId, summary: `ABR quality ${entry.id}` })), ...evidence.abr.findings.map((entry) => ({ id: entry.evidenceId, summary: `${entry.ruleId}: ${entry.title}` })), ...evidence.abr.transitions.map((entry) => ({ id: entry.evidenceId, summary: `${entry.transitionStatus.toLowerCase()} ABR ${entry.sourceRepresentation.id} -> ${entry.targetRepresentation.id}` }))] : []),
    ...(evidence.dash?.switches?.flatMap(abrEvidenceIndex) ?? []),
    ...(evidence.playbackSwitches?.flatMap(abrEvidenceIndex) ?? []),
  ];
}

/** The Lead receives deterministic conclusions and indexes, not a fourth copy
 * of all media probes. It can inspect preserved samples explicitly when a
 * finding needs deeper support. */
function leadEvidence(evidence: EvidenceBundleV2 | EvidenceBundleV3): object {
  return {
    protocol: evidence.source.protocol,
    manifests: manifestIndex(evidence, { timingTags: true }),
    observations: evidence.observations,
    limitations: evidence.limitations,
    reportedContext: evidence.reportedContext,
    abr: evidence.abr,
    ...(evidence.timeline?.length ? { timeline: evidence.timeline } : {}),
    ...(evidence.playbackSwitches?.length ? { playbackSwitches: evidence.playbackSwitches.map(sanitizeAbrSwitch) } : {}),
  };
}

function sanitizedHls(hls: NonNullable<EvidenceBundleV2["hls"]>): object {
  return {
    ...hls,
    variants: hls.variants.map(({ uri: _uri, url: _url, ...variant }) => variant),
    renditions: hls.renditions.map(({ uri: _uri, url: _url, ...rendition }) => rendition),
  };
}

function sanitizeAbrSwitch(entry: AbrSwitchEvidence): object {
  return {
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
  };
}

function compactMediaSamples(samples: EvidenceBundleV2["mediaSamples"]): object[] {
  const emittedInitHashes = new Set<string>();
  return samples.map((sample) => {
    const probe = sample.probe as EvidenceProbe | undefined;
    const init = probe?.fmp4?.init;
    const repeatedInit = init ? emittedInitHashes.has(init.sha256) : false;
    if (init) emittedInitHashes.add(init.sha256);
    const { source, ...sampleWithoutSource } = sample;
    return {
      ...sampleWithoutSource,
      ...(source ? { source: {
        sha256: source.sha256,
        ...(source.observedHashes ? { observedHashes: source.observedHashes } : {}),
        httpStatus: source.httpStatus,
        ...(source.contentLength === undefined ? {} : { contentLength: source.contentLength }),
        ...(source.http ? { http: source.http } : {}),
      } } : {}),
      ...(probe ? { probe: compactProbe(probe, repeatedInit) } : {}),
    };
  });
}

type EvidenceProbe = NonNullable<EvidenceBundleV2["mediaSamples"][number]["probe"]> & {
  boundary?: import("../ports/media-sample-collector.js").FfprobeBoundarySummary;
};

function compactProbe(probe: EvidenceProbe, repeatedInit: boolean): object {
  const fragment = probe.fmp4?.fragment;
  const init = probe.fmp4?.init;
  return {
    ...(probe.format ? { format: probe.format } : {}),
    ...(probe.duration === undefined ? {} : { duration: probe.duration }),
    tracks: probe.tracks,
    ...(probe.structural ? { structural: probe.structural } : {}),
    ...(probe.boundary ? { boundary: {
      totalGopCount: probe.boundary.totalGopCount,
      totalPacketCount: probe.boundary.totalPacketCount,
      totalFrameCount: probe.boundary.totalFrameCount,
      gops: probe.boundary.gops.map((gop) => ({
        index: gop.index,
        startFrameIndex: gop.startFrameIndex,
        frameCount: gop.frameCount,
        startsWithKeyFrame: gop.startsWithKeyFrame,
        ...(gop.firstPtsTime === undefined ? {} : { firstPtsTime: gop.firstPtsTime }),
        ...(gop.lastPtsTime === undefined ? {} : { lastPtsTime: gop.lastPtsTime }),
        truncated: gop.truncated,
      })),
    } } : {}),
    ...(init || fragment ? { fmp4: {
      ...(init ? { init: repeatedInit
        ? {
            sha256: init.sha256,
            fourcc: init.fourcc,
            timescale: init.timescale,
            nalLengthSize: init.nalLengthSize,
            repeatedSemanticInit: true,
          }
        : init } : {}),
      ...(fragment ? { fragment: {
        styp: fragment.styp,
        sidx: fragment.sidx,
        sequenceNumber: fragment.sequenceNumber,
        baseMediaDecodeTime: fragment.baseMediaDecodeTime,
        trafs: fragment.trafs.map((traf) => ({
          tfhd: traf.tfhd,
          tfdt: traf.tfdt,
          truns: traf.truns.map(({ samples: _samples, ...trun }) => trun),
          drmBoxTypes: traf.drmBoxTypes,
        })),
        sampleCount: fragment.samples.length,
        syncSampleCount: fragment.samples.filter((entry) => entry.sync).length,
        firstSample: fragment.samples[0],
        lastSample: fragment.samples.length > 1 ? fragment.samples[fragment.samples.length - 1] : undefined,
        drmBoxTypes: fragment.drmBoxTypes,
        structuralErrors: fragment.structuralErrors,
      } } : {}),
    } } : {}),
  };
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
