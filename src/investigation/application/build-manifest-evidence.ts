import type { EvidenceBundleV2, ManifestEvidence } from "../domain/evidence.js";
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
  const variant = collection.manifests.find((manifest) => manifest.role === "variant");
  const audio = collection.manifests.find((manifest) =>
    manifest.logicalKey === "manifest/rendition/audio/0");
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
      ? ["HLS media was sampled from one representative variant; cross-variant boundary safety was not measured."]
      : [],
  });

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
        ...(collection.hlsSelection ? {
          selection: {
            rule: collection.hlsSelection.rule,
            variantIndex: collection.hlsSelection.variant.index,
            ...(variant?.artifact ? { variantLogicalKey: variant.logicalKey } : {}),
            ...(collection.hlsSelection.audioRendition
              ? { audioRenditionIndex: collection.hlsSelection.audioRendition.index }
              : {}),
            ...(audio?.artifact ? { audioRenditionLogicalKey: audio.logicalKey } : {}),
          },
        } : {}),
      },
    } : {}),
    observations,
    limitations: [
      ...(root.inspection.protocol === "hls" && root.inspection.kind === "master"
        ? [
          "One representative HLS variant and at most one linked audio rendition were selected deterministically.",
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
      ...(collection.mediaLimitations ?? []),
    ],
  };
}

export function buildManifestReport(
  job: ClaimedInvestigationJob,
  evidence: EvidenceBundleV2,
  ai?: AiInvestigationResult,
): InvestigationReportContent {
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
    evidence,
    ...(ai ? { ai } : {}),
    generatedBy: "deterministic-media-v1",
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
    ...(hls?.targetDuration !== undefined ? { targetDuration: hls.targetDuration } : {}),
    ...(hls?.mediaSequence !== undefined ? { mediaSequence: hls.mediaSequence } : {}),
    ...(hls?.discontinuitySequence !== undefined
      ? { discontinuitySequence: hls.discontinuitySequence }
      : {}),
    ...(hls ? { discontinuityCount: hls.discontinuityCount, hasEndList: hls.hasEndList } : {}),
  };
}

function requireArtifact(
  manifest: Manifest,
): asserts manifest is Manifest & { artifact: NonNullable<Manifest["artifact"]> } {
  if (!manifest.artifact) {
    throw new Error(`Manifest ${manifest.logicalKey} has not been stored as an artifact`);
  }
}
