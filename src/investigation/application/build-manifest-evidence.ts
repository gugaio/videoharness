import type { EvidenceBundleV2, HlsVariantTopology, ManifestEvidence } from "../domain/evidence.js";
import type { ClaimedInvestigationJob } from "../domain/investigation-job.js";
import type { InvestigationReportContent } from "../domain/investigation-report.js";
import type {
  Manifest,
  ManifestCollection,
} from "../ports/manifest-collector.js";
import type { MediaSample } from "../ports/media-sample-collector.js";
import type { AiInvestigationResult } from "../ports/investigation-ai.js";
import { analyzeDashSwitchCandidates } from "../../abr/application/analyze-dash-switch-candidates.js";
import { buildAbrSwitchMatrix, reconfigurationSensitivitySummary } from "../../abr/application/switch-matrix.js";
import { buildAbrAssessment } from "../../abr/application/assess-stream-abr.js";
import { projectDecoderCapability } from "../../abr/application/project-decoder-capability.js";
import { analyzeTimelineContinuity } from "./analyze-timeline-continuity.js";
import type { AbrReportedPriority, AbrRepresentation } from "../../abr/domain/assessment.js";

export function buildManifestEvidence(collection: ManifestCollection): EvidenceBundleV2 {
  const root = collection.manifests.find((manifest) => manifest.role === "root");
  if (!root) throw new Error("Manifest collection has no root manifest");
  requireArtifact(root);
  const rootHls = root.inspection.hls;
  const rootDash = root.inspection.dash;
  const dashSwitches = rootDash ? analyzeDashSwitchCandidates(rootDash, collection.mediaSamples ?? [], collection.reportedContext) : [];
  const switchMatrix = rootDash ? buildAbrSwitchMatrix(rootDash.representations.filter((entry) => entry.contentType === "video").map((entry) => ({ evidenceId: `representation:${entry.id}`, id: entry.id, periodIndex: entry.periodIndex, adaptationSetIndex: entry.adaptationSetIndex, ...(entry.bandwidth === undefined ? {} : { bandwidth: entry.bandwidth }), ...(entry.codecs ? { codecs: entry.codecs } : {}), ...(entry.width === undefined ? {} : { width: entry.width }), ...(entry.height === undefined ? {} : { height: entry.height }), ...(entry.frameRate ? { frameRate: entry.frameRate } : {}), timescale: entry.timescale, presentationTimeOffset: String(entry.presentationTimeOffset) })), dashSwitches) : [];
  const reconfigurationSensitivity = reconfigurationSensitivitySummary(switchMatrix);
  const audio = collection.manifests.find((manifest) =>
    manifest.logicalKey === "manifest/rendition/audio/0");
  const variantManifests = collection.manifests.filter((manifest) => manifest.role === "variant");
  const selectedVariantLogicalKey = collection.hlsSelection
    ? `manifest/variant/${collection.hlsSelection.variant.index}`
    : undefined;
  const topology = variantManifests.map(toVariantTopology);
  const sampledVideoKeys = new Set(
    (collection.mediaSamples ?? [])
      .filter((sample) => sample.kind === "media-segment" && sample.sourceManifestLogicalKey?.startsWith("manifest/variant/"))
      .map((sample) => sample.sourceManifestLogicalKey!),
  );
  const sampledVariants = rootHls
    ? rootHls.variants.filter((entry) => sampledVideoKeys.has(`manifest/variant/${entry.index}`))
    : [];
  const observations: EvidenceBundleV2["observations"] = [{
    code: "MANIFEST_DETECTED",
    severity: "info",
    message: `${root.inspection.protocol.toUpperCase()} ${root.inspection.kind} manifest detected.`,
  }];
  if (collection.hlsSelection) {
    observations.push({
      code: "HLS_VARIANT_SELECTED",
      severity: "info",
      message: `Variant ${collection.hlsSelection.variant.index} selected by highest bandwidth for bounded investigation.`,
    });
  }
  if (audio?.artifact && collection.hlsSelection?.audioRendition) {
    observations.push({
      code: "HLS_AUDIO_RENDITION_SELECTED",
      severity: "info",
      message: `Linked audio rendition ${collection.hlsSelection.audioRendition.index} selected for bounded investigation.`,
    });
  }
  if (variantManifests.length > 1) {
    observations.push({
      code: "HLS_LADDER_PLAYLISTS_DECLARED",
      severity: "info",
      message: `${variantManifests.length} HLS variant playlists were collected across the declared ladder.`,
    });
    const targetDurations = new Set(variantManifests
      .map((manifest) => manifest.inspection.hls?.targetDuration)
      .filter((value): value is number => value !== undefined));
    if (targetDurations.size > 1) {
      observations.push({
        code: "HLS_TARGET_DURATION_MISMATCH",
        severity: "warning",
        message: `Variant playlists declare different target durations: ${[...targetDurations].sort((left, right) => left - right).join(", ")}s.`,
      });
    }
    const discontinuities = variantManifests.filter((manifest) => (manifest.inspection.hls?.discontinuityCount ?? 0) > 0);
    if (discontinuities.length > 0 && discontinuities.length !== variantManifests.length) {
      observations.push({
        code: "HLS_DISCONTINUITY_MISMATCH",
        severity: "warning",
        message: `${discontinuities.length} of ${variantManifests.length} variant playlists declare discontinuities while others do not.`,
      });
    }
  }
  if (sampledVariants.length >= 2) {
    observations.push({
      code: "HLS_MULTI_VARIANT_SAMPLED",
      severity: "info",
      message: `Aligned bounded media windows were sampled from ${sampledVariants.length} adjacent HLS variants (${sampledVariants.map((entry) => entry.index).join(", ")}).`,
    });
  }
  const drmSchemes = collectDrmSchemes(collection.mediaSamples ?? []);
  if (drmSchemes.size > 0) {
    observations.push({
      code: "DRM_DETECTED",
      severity: "info",
      message: `Sampled media declares ${[...drmSchemes].sort().join(", ")} content protection.`,
    });
  }
  const avOffset = findAvOffset(collection.mediaSamples ?? []);
  if (avOffset !== undefined) {
    observations.push({
      code: "AV_INITIAL_TIMESTAMP_OFFSET",
      severity: Math.abs(avOffset) > 0.1 ? "warning" : "info",
      message: `Sampled audio starts ${formatOffset(avOffset)} relative to sampled video.`,
    });
  }
  const abr = buildAbrAssessment({
    protocol: root.inspection.protocol,
    representations: rootDash ? dashAbrRepresentations(rootDash.representations) : hlsAbrRepresentations(rootHls?.variants ?? []),
    audioRenditionCount: rootDash ? rootDash.representations.filter((entry) => entry.contentType === "audio").length : rootHls?.renditions.filter((entry) => entry.type.toUpperCase() === "AUDIO").length ?? 0,
    mediaSampleCount: collection.mediaSamples?.length ?? 0,
    transitions: dashSwitches,
    transitionMatrix: switchMatrix,
    reportedPriority: abrReportedPriority(collection.reportedContext),
    coverageLimitations: root.inspection.protocol === "hls" && (rootHls?.variants.length ?? 0) > 1
      ? sampledVariants.length >= 2
        ? ["HLS cross-variant media was sampled in aligned windows; boundary safety between the variants is only partially observable until dedicated decode/boundary evidence is collected."]
        : ["HLS media was sampled from one representative variant; cross-variant boundary safety was not measured."]
      : [],
  });
  abr.capability = projectDecoderCapability(abr.ladder.representations);
  const maxLevel = abr.capability.maxRequiredLevelNumeric;
  if (maxLevel !== undefined && (abr.capability.codecFamily === "HEVC" || abr.capability.codecFamily === "H264") && maxLevel >= 5.1) {
    observations.push({
      code: "DECODER_CAPABILITY_HIGH_LEVEL",
      severity: "warning",
      message: `The highest ladder rung requires ${abr.capability.codecFamily} ${abr.capability.maxRequiredLevel}; devices without that decoder capability may fail or skip it.`,
    });
  }
  const timeline = analyzeTimelineContinuity(collection.mediaSamples ?? []);
  const discontinuousWindows = timeline.filter((window) => !window.continuous);
  for (const window of discontinuousWindows) {
    observations.push({
      code: "TIMELINE_SEGMENT_GAP",
      severity: "warning",
      message: `${window.key} shows ${window.gaps.length} boundary gap/overlap fact(s), ${window.totalGapMs} ms of total presentation gap.`,
    });
  }
  if (timeline.some((window) => window.segmentCount > 1 && window.continuous)) {
    observations.push({
      code: "TIMELINE_CONTIGUOUS",
      severity: "info",
      message: "Adjacent sampled chunks keep a continuous presentation timeline.",
    });
  }

  return {
    schemaVersion: 2,
    collectedAt: new Date().toISOString(),
    source: {
      requestedUrl: root.source.requestedUrl,
      finalUrl: root.source.finalUrl,
      protocol: root.inspection.protocol,
      httpStatus: root.source.statusCode,
      ...(root.source.contentType ? { contentType: root.source.contentType } : {}),
    },
    manifests: collection.manifests.map(toManifestEvidence),
    mediaSamples: (collection.mediaSamples ?? []).map(toMediaSampleEvidence),
    abr,
    ...(collection.reportedContext ? { reportedContext: collection.reportedContext } : {}),
    ...(rootDash ? { dash: {
      type: rootDash.type,
      periods: rootDash.periods,
      adaptationSets: rootDash.adaptationSets,
      representations: rootDash.representations.map((representation) => ({
        id: representation.id,
        periodIndex: representation.periodIndex,
        adaptationSetIndex: representation.adaptationSetIndex,
        contentType: representation.contentType,
        ...(representation.codecs ? { codecs: representation.codecs } : {}),
        ...(representation.bandwidth === undefined ? {} : { bandwidth: representation.bandwidth }),
        ...(representation.width === undefined ? {} : { width: representation.width }),
        ...(representation.height === undefined ? {} : { height: representation.height }),
        ...(representation.frameRate ? { frameRate: representation.frameRate } : {}),
        ...(representation.sar ? { sar: representation.sar } : {}),
        baseUrl: representation.baseUrl,
        timescale: representation.timescale,
        presentationTimeOffset: String(representation.presentationTimeOffset),
        ...(representation.initializationUrl ? { initializationUrl: representation.initializationUrl } : {}),
        ...(representation.mediaTemplate ? { mediaTemplate: representation.mediaTemplate } : {}),
        segmentAddressing: representation.segmentAddressing,
        ...(representation.segmentAlignment === undefined ? {} : { segmentAlignment: representation.segmentAlignment }),
        ...(representation.subsegmentAlignment === undefined ? {} : { subsegmentAlignment: representation.subsegmentAlignment }),
        ...(representation.startWithSap === undefined ? {} : { startWithSap: representation.startWithSap }),
        ...(representation.subsegmentStartsWithSap === undefined ? {} : { subsegmentStartsWithSap: representation.subsegmentStartsWithSap }),
        ...(representation.bitstreamSwitching === undefined ? {} : { bitstreamSwitching: representation.bitstreamSwitching }),
        contentProtection: representation.contentProtection,
        segmentCount: representation.segments.length,
      })),
      limitations: rootDash.limitations,
      switches: dashSwitches,
      switchMatrix,
      ...(reconfigurationSensitivity ? { reconfigurationSensitivity } : {}),
    } } : {}),
    ...(rootHls ? {
      hls: {
        variants: rootHls.variants,
        renditions: rootHls.renditions,
        ...(topology.length ? { topology } : {}),
        ...(collection.hlsSelection ? {
          selection: {
            rule: collection.hlsSelection.rule,
            variantIndex: collection.hlsSelection.variant.index,
            ...(selectedVariantLogicalKey ? { variantLogicalKey: selectedVariantLogicalKey } : {}),
            ...(collection.hlsSelection.audioRendition
              ? { audioRenditionIndex: collection.hlsSelection.audioRendition.index }
              : {}),
            ...(audio?.artifact ? { audioRenditionLogicalKey: audio.logicalKey } : {}),
            ...(sampledVariants.length
              ? { sampledVariants: sampledVariants.map((entry) => ({ index: entry.index, logicalKey: `manifest/variant/${entry.index}` })) }
              : {}),
          },
        } : {}),
      },
    } : {}),
    ...(timeline.length ? { timeline } : {}),
    observations,
    limitations: [
      ...(root.inspection.protocol === "hls" && root.inspection.kind === "master"
        ? [
          sampledVariants.length >= 2
            ? "Two adjacent HLS video variants and at most one linked audio rendition were sampled within a shared bounded window."
            : "One representative HLS variant and at most one linked audio rendition were sampled within a bounded window.",
        ]
        : root.inspection.protocol === "hls" && root.inspection.kind === "media"
          ? [
            "The submitted HLS media playlist was sampled directly; no master playlist or alternate variants were available.",
          ]
        : [
          "Only the submitted manifest was collected in this investigation phase.",
        ]),
      ...(collection.mediaSamples?.length
        ? ["The media inspection is a bounded sample, not a full playback simulation."]
        : ["Segments, codecs, timestamps and playback behavior were not analyzed yet."]),
      ...(drmSchemes.size
        ? ["The sampled media is protected by DRM; ciphertext bytes remain unmodified and decode/playback was not performed."]
        : []),
      ...(collection.mediaLimitations ?? []),
    ],
  };
}

export function buildManifestReport(
  job: ClaimedInvestigationJob,
  evidence: EvidenceBundleV2,
  ai?: AiInvestigationResult,
): InvestigationReportContent {
  // The report is a shareable conclusion. Prompt/input/output audits live in
  // agent_runs, where the workspace can inspect them without duplicating them.
  const reportAi = ai ? { ...ai, promptAudits: [] } : undefined;
  const rootManifest = evidence.manifests[0]!;
  const selectedVariant = evidence.hls?.selection
    ? evidence.hls.variants.find((variant) => variant.index === evidence.hls?.selection?.variantIndex)
    : undefined;
  return {
    placeholder: false,
    title: evidence.dash ? "DASH representation-boundary evidence collected" : `${evidence.source.protocol.toUpperCase()} media evidence collected`,
    summary: `${evidence.manifests.length} ${evidence.source.protocol.toUpperCase()} manifest artifact${
      evidence.manifests.length === 1 ? "" : "s"
    } and ${evidence.mediaSamples.length} bounded media sample artifact${evidence.mediaSamples.length === 1 ? "" : "s"} were fetched through the protected network boundary and preserved as evidence.`,
    ...(job.investigation.problemDescription
      ? { problemReported: job.investigation.problemDescription }
      : {}),
    findings: [
      {
        title: "Manifest detected",
        status: "observed",
        explanation: `${evidence.source.protocol.toUpperCase()} ${rootManifest.kind}, ${rootManifest.sizeBytes} bytes, ${evidence.manifests.length} manifest artifact${evidence.manifests.length === 1 ? "" : "s"}.`,
      },
      ...(selectedVariant ? [{
        title: "Representative HLS variant",
        status: "observed" as const,
        explanation: `Variant ${selectedVariant.index} selected by highest bandwidth${
          selectedVariant.bandwidth !== undefined ? ` (${selectedVariant.bandwidth} bps)` : ""
        }${selectedVariant.resolution ? `, ${selectedVariant.resolution}` : ""}.`,
      }] : []),
      ...(evidence.dash ? [{
        title: "DASH representation ladder",
        status: "observed" as const,
        explanation: `${evidence.dash.representations.filter((representation) => representation.contentType === "video").length} video and ${evidence.dash.representations.filter((representation) => representation.contentType === "audio").length} audio representations were expanded from the MPD.`,
      }] : []),
      {
        title: "ABR quality baseline",
        status: evidence.abr?.verdict === "ISSUES_FOUND" || evidence.abr?.verdict === "INCONCLUSIVE" ? "limitation" as const : "observed" as const,
        explanation: evidence.abr ? describeAbrAssessment(evidence.abr) : "ABR assessment is unavailable for this historical report.",
      },
      ...(evidence.mediaSamples.filter((sample) => sample.probe).map((sample) => ({
        title: `Media sample ${sample.logicalKey}`,
        status: "observed" as const,
        explanation: describeProbe(sample),
      }))),
      ...(evidence.observations.filter((observation) => observation.code === "AV_INITIAL_TIMESTAMP_OFFSET").map((observation) => ({
        title: "Initial A/V timestamp offset",
        status: "observed" as const,
        explanation: observation.message,
      }))),
      ...(ai?.findings.map((finding) => ({ title: finding.title, status: finding.severity === "info" ? "observed" as const : "limitation" as const, explanation: `${finding.explanation} Evidence: ${finding.evidenceIds.join(", ")}.` })) ?? []),
      {
        title: "Current analysis boundary",
        status: "limitation",
        explanation: evidence.limitations.join(" "),
      },
    ],
    confidence: {
      level: "limited",
      explanation: ai?.likelyCause
        ? `AI synthesis: ${ai.likelyCause}`
        : evidence.dash
          ? "The reported symptom prioritized a candidate DASH boundary. The media facts are observed, but the actual player switch and device buffer state are not available in this investigation."
          : "The manifest and a bounded media sample are directly observed, but root-cause confidence requires broader playback and delivery evidence.",
    },
    evidence: reportEvidence(evidence),
    ...(reportAi ? { ai: reportAi } : {}),
    generatedBy: "deterministic-media-v1",
  };
}

function reportEvidence(evidence: EvidenceBundleV2): EvidenceBundleV2 {
  return {
    ...evidence,
    manifests: evidence.manifests.map(({ content: _content, ...manifest }) => manifest),
  };
}

function hlsAbrRepresentations(variants: NonNullable<Manifest["inspection"]["hls"]>["variants"]): AbrRepresentation[] {
  return variants.map((variant) => {
    const resolution = parseResolution(variant.resolution);
    return {
      evidenceId: `hls-variant:${variant.index}`,
      id: `variant-${variant.index}`,
      groupId: "hls:video",
      ...(variant.bandwidth === undefined ? {} : { bandwidth: variant.bandwidth }),
      ...(variant.averageBandwidth === undefined ? {} : { averageBandwidth: variant.averageBandwidth }),
      ...(resolution ? { width: resolution.width, height: resolution.height } : {}),
      ...(variant.frameRate === undefined ? {} : { frameRate: variant.frameRate }),
      ...(variant.codecs ? { codecs: variant.codecs } : {}),
      ...(variant.audioGroupId ? { audioGroupId: variant.audioGroupId } : {}),
    };
  });
}

function dashAbrRepresentations(representations: NonNullable<Manifest["inspection"]["dash"]>["representations"]): AbrRepresentation[] {
  return representations.filter((entry) => entry.contentType === "video").map((entry) => ({
    evidenceId: `representation:${entry.id}`,
    id: entry.id,
    groupId: `dash:p${entry.periodIndex}:a${entry.adaptationSetIndex}`,
    ...(entry.bandwidth === undefined ? {} : { bandwidth: entry.bandwidth }),
    ...(entry.width === undefined ? {} : { width: entry.width }),
    ...(entry.height === undefined ? {} : { height: entry.height }),
    ...(entry.frameRate && Number.isFinite(Number(entry.frameRate)) ? { frameRate: Number(entry.frameRate) } : {}),
    ...(entry.codecs ? { codecs: entry.codecs } : {}),
    segmentCount: entry.segments.length,
  }));
}

function abrReportedPriority(context: ManifestCollection["reportedContext"]): AbrReportedPriority {
  return {
    abrProblemReported: context?.reportsAbrSwitch ?? false,
    ...(context?.reportedAbrDirection ? { direction: context.reportedAbrDirection } : {}),
    ...(context?.reportedResolutionTransition ? { sourceHeight: context.reportedResolutionTransition.sourceHeight, targetHeight: context.reportedResolutionTransition.targetHeight } : {}),
    ...(context?.approximateTimeSeconds === undefined ? {} : { approximateTimeSeconds: context.approximateTimeSeconds }),
  };
}

function parseResolution(value: string | undefined): { width: number; height: number } | undefined { const match = /^(\d+)x(\d+)$/i.exec(value ?? ""); if (!match) return undefined; return { width: Number(match[1]), height: Number(match[2]) }; }
function describeAbrAssessment(assessment: NonNullable<EvidenceBundleV2["abr"]>): string { const verdict = assessment.verdict === "NO_ISSUE_DETECTED" ? "No ABR issue was detected" : assessment.verdict === "ISSUES_FOUND" ? "ABR risks were found" : assessment.verdict === "NOT_APPLICABLE" ? "Video ABR is not applicable to the observed topology" : "The ABR assessment is inconclusive"; return `${verdict}. ${assessment.ladder.videoRepresentationCount} video quality${assessment.ladder.videoRepresentationCount === 1 ? "" : "ies"}, ${assessment.findings.length} deterministic finding${assessment.findings.length === 1 ? "" : "s"}, coverage ${assessment.coverage.level.toLowerCase().replaceAll("_", " ")}.`; }

function toMediaSampleEvidence(sample: MediaSample): EvidenceBundleV2["mediaSamples"][number] {
  if (!sample.artifact) throw new Error(`Media sample ${sample.logicalKey} has not been stored as an artifact`);
  return {
    artifactId: sample.artifact.id,
    logicalKey: sample.logicalKey,
    kind: sample.kind,
    sizeBytes: sample.artifact.sizeBytes,
    ...(sample.artifact.sha256 ? { sha256: sample.artifact.sha256 } : {}),
    sourceManifestLogicalKey: sample.sourceManifestLogicalKey,
    ...(sample.sampleIndex === undefined ? {} : { sampleIndex: sample.sampleIndex }),
    ...(sample.sequence === undefined ? {} : { sequence: sample.sequence }),
    ...(sample.declaredDuration === undefined ? {} : { declaredDuration: sample.declaredDuration }),
    ...(sample.representationId === undefined ? {} : { representationId: sample.representationId }),
    ...(sample.periodIndex === undefined ? {} : { periodIndex: sample.periodIndex }),
    ...(sample.adaptationSetIndex === undefined ? {} : { adaptationSetIndex: sample.adaptationSetIndex }),
    ...(sample.presentationStartSeconds === undefined ? {} : { presentationStartSeconds: sample.presentationStartSeconds }),
    ...(sample.presentationEndSeconds === undefined ? {} : { presentationEndSeconds: sample.presentationEndSeconds }),
    ...(sample.source ? { source: sample.source } : {}),
    ...(sample.probe ? { probe: sample.probe } : {}),
  };
}

function describeProbe(sample: EvidenceBundleV2["mediaSamples"][number]): string {
  const tracks = sample.probe?.tracks ?? [];
  const description = tracks.map((track) => `${track.kind}${track.codec ? ` ${track.codec}` : ""}`).join(", ");
  return `${sample.kind} ${sample.sizeBytes} bytes${sample.probe?.format ? ` (${sample.probe.format})` : ""}; tracks: ${description || "none detected"}.`;
}

function findAvOffset(samples: MediaSample[]): number | undefined {
  for (const sample of samples.filter((entry) => entry.kind === "media-segment")) {
    const video = sample.probe?.tracks.find((track) => track.kind === "video" && track.firstPts !== undefined);
    const audio = sample.probe?.tracks.find((track) => track.kind === "audio" && track.firstPts !== undefined);
    if (video?.firstPts !== undefined && audio?.firstPts !== undefined) return audio.firstPts - video.firstPts;
  }
  return undefined;
}

function formatOffset(offset: number): string {
  const milliseconds = Math.round(Math.abs(offset) * 1_000);
  return `${milliseconds} ms ${offset >= 0 ? "after" : "before"}`;
}

function collectDrmSchemes(samples: MediaSample[]): Set<string> {
  const schemes = new Set<string>();
  for (const sample of samples) {
    for (const pssh of sample.probe?.fmp4?.init?.drm?.pssh ?? []) {
      if (pssh.classification !== "unknown") schemes.add(pssh.classification);
    }
  }
  return schemes;
}

function toVariantTopology(manifest: Manifest): HlsVariantTopology {
  const match = /^manifest\/variant\/(\d+)$/.exec(manifest.logicalKey);
  const hls = manifest.inspection.hls;
  return {
    index: match ? Number(match[1]) : -1,
    logicalKey: manifest.logicalKey,
    segmentCount: manifest.inspection.segmentCount ?? 0,
    ...(hls?.targetDuration !== undefined ? { targetDuration: hls.targetDuration } : {}),
    ...(hls?.discontinuityCount ? { discontinuityCount: hls.discontinuityCount } : {}),
    ...(hls?.hasEndList === undefined ? {} : { hasEndList: hls.hasEndList }),
  };
}

function toManifestEvidence(manifest: Manifest): ManifestEvidence {
  requireArtifact(manifest);
  const inspection = manifest.inspection;
  const hls = inspection.hls;
  return {
    artifactId: manifest.artifact.id,
    logicalKey: manifest.logicalKey,
    role: manifest.role,
    requestedUrl: manifest.source.requestedUrl,
    finalUrl: manifest.source.finalUrl,
    kind: inspection.kind,
    sizeBytes: manifest.artifact.sizeBytes,
    ...(manifest.artifact.sha256 ? { sha256: manifest.artifact.sha256 } : {}),
    ...(inspection.variantCount !== undefined ? { variantCount: inspection.variantCount } : {}),
    ...(inspection.segmentCount !== undefined ? { segmentCount: inspection.segmentCount } : {}),
    ...(inspection.representationCount !== undefined
      ? { representationCount: inspection.representationCount }
      : {}),
    ...(manifest.source.http ? { http: manifest.source.http } : {}),
    ...(hls?.targetDuration !== undefined ? { targetDuration: hls.targetDuration } : {}),
    ...(hls?.mediaSequence !== undefined ? { mediaSequence: hls.mediaSequence } : {}),
    ...(hls?.discontinuitySequence !== undefined
      ? { discontinuitySequence: hls.discontinuitySequence }
      : {}),
    ...(hls ? { discontinuityCount: hls.discontinuityCount, hasEndList: hls.hasEndList } : {}),
    ...(manifest.content.bytes.byteLength > 0
      ? { content: boundedManifestContent(manifest.content.bytes) }
      : {}),
  };
}

const MAX_MANIFEST_CONTENT_CHARS = 32_768;

function boundedManifestContent(bytes: Uint8Array): string {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (text.length <= MAX_MANIFEST_CONTENT_CHARS) return text;
  const kept = text.slice(0, MAX_MANIFEST_CONTENT_CHARS);
  return `${kept}\n[... manifest content truncated to ${MAX_MANIFEST_CONTENT_CHARS} characters; the full artifact is preserved. ...]`;
}

function requireArtifact(
  manifest: Manifest,
): asserts manifest is Manifest & { artifact: NonNullable<Manifest["artifact"]> } {
  if (!manifest.artifact) {
    throw new Error(`Manifest ${manifest.logicalKey} has not been stored as an artifact`);
  }
}
