import type { EvidenceBundleV2, ManifestEvidence } from "../domain/evidence.js";
import type { ClaimedInvestigationJob } from "../domain/investigation-job.js";
import type { InvestigationReportContent } from "../domain/investigation-report.js";
import type {
  Manifest,
  ManifestCollection,
} from "../ports/manifest-collector.js";
import type { MediaSample } from "../ports/media-sample-collector.js";
import type { AiInvestigationResult } from "../ports/investigation-ai.js";
import { analyzeDashForensics } from "./analyze-dash-forensics.js";

export function buildManifestEvidence(collection: ManifestCollection): EvidenceBundleV2 {
  const root = collection.manifests.find((manifest) => manifest.role === "root");
  if (!root) throw new Error("Manifest collection has no root manifest");
  requireArtifact(root);
  const rootHls = root.inspection.hls;
  const rootDash = root.inspection.dash;
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
    ...(collection.reportedContext ? { reportedContext: collection.reportedContext } : {}),
    ...(rootDash ? { dash: {
      type: rootDash.type,
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
        timescale: representation.timescale,
        ...(representation.segmentAlignment === undefined ? {} : { segmentAlignment: representation.segmentAlignment }),
        ...(representation.bitstreamSwitching === undefined ? {} : { bitstreamSwitching: representation.bitstreamSwitching }),
        segmentCount: representation.segments.length,
      })),
      limitations: rootDash.limitations,
      analysis: analyzeDashForensics(rootDash, collection.mediaSamples ?? [], collection.reportedContext),
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
  const dashAnalysis = evidence.dash?.analysis;
  const candidateBoundary = dashAnalysis?.boundaries.find((boundary) =>
    boundary.sourceRepresentationId === dashAnalysis.candidate?.sourceRepresentationId
      && boundary.destinationRepresentationId === dashAnalysis.candidate?.destinationRepresentationId);
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
      ...(candidateBoundary ? [{
        title: "Candidate representation boundary",
        status: candidateBoundary.classification === "continuous" ? "observed" as const : "limitation" as const,
        explanation: `${candidateBoundary.sourceRepresentationId} → ${candidateBoundary.destinationRepresentationId}: ${candidateBoundary.classification}${candidateBoundary.firstFrameKind ? `; first destination frame ${candidateBoundary.firstFrameKind}` : ""}${candidateBoundary.initCompatible === false ? "; init configuration differs" : ""}.${candidateBoundary.reasons.length ? ` ${candidateBoundary.reasons.join(" ")}` : ""}`,
      }] : []),
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
