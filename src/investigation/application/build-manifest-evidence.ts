import type { EvidenceBundleV2, ManifestEvidence } from "../domain/evidence.js";
import type { ClaimedInvestigationJob } from "../domain/investigation-job.js";
import type { InvestigationReportContent } from "../domain/investigation-report.js";
import type {
  CollectedManifest,
  CollectedManifestEvidence,
} from "../ports/stream-evidence-collector.js";

export type PromotedManifest = {
  artifactId: string;
  storageKey: string;
  sizeBytes: number;
  collected: CollectedManifest;
};

export function buildManifestEvidence(
  promoted: PromotedManifest[],
  collected: CollectedManifestEvidence,
): EvidenceBundleV2 {
  const root = promoted.find((manifest) => manifest.collected.role === "root");
  if (!root) throw new Error("Collected manifest evidence has no root artifact");
  const rootHls = root.collected.inspection.hls;
  const variantArtifact = promoted.find((manifest) => manifest.collected.role === "variant");
  const audioArtifact = promoted.find((manifest) =>
    manifest.collected.logicalKey === "manifest/rendition/audio/0");
  const observations: EvidenceBundleV2["observations"] = [{
    code: "MANIFEST_DETECTED",
    severity: "info",
    message: `${root.collected.inspection.protocol.toUpperCase()} ${root.collected.inspection.kind} manifest detected.`,
  }];
  if (collected.hlsSelection) {
    observations.push({
      code: "HLS_VARIANT_SELECTED",
      severity: "info",
      message: `Variant ${collected.hlsSelection.variant.index} selected by highest bandwidth for bounded investigation.`,
    });
  }
  if (audioArtifact && collected.hlsSelection?.audioRendition) {
    observations.push({
      code: "HLS_AUDIO_RENDITION_SELECTED",
      severity: "info",
      message: `Linked audio rendition ${collected.hlsSelection.audioRendition.index} selected for bounded investigation.`,
    });
  }

  return {
    schemaVersion: 2,
    collectedAt: new Date().toISOString(),
    source: {
      requestedUrl: root.collected.requestedUrl,
      finalUrl: root.collected.finalUrl,
      protocol: root.collected.inspection.protocol,
      httpStatus: root.collected.statusCode,
      ...(root.collected.contentType ? { contentType: root.collected.contentType } : {}),
    },
    manifests: promoted.map(toManifestEvidence),
    mediaSamples: [],
    ...(rootHls ? {
      hls: {
        variants: rootHls.variants,
        renditions: rootHls.renditions,
        ...(collected.hlsSelection ? {
          selection: {
            rule: collected.hlsSelection.rule,
            variantIndex: collected.hlsSelection.variant.index,
            ...(variantArtifact ? { variantLogicalKey: variantArtifact.collected.logicalKey } : {}),
            ...(collected.hlsSelection.audioRendition
              ? { audioRenditionIndex: collected.hlsSelection.audioRendition.index }
              : {}),
            ...(audioArtifact ? { audioRenditionLogicalKey: audioArtifact.collected.logicalKey } : {}),
          },
        } : {}),
      },
    } : {}),
    observations,
    limitations: root.collected.inspection.protocol === "hls" && root.collected.inspection.kind === "master"
      ? [
          "One representative HLS variant and at most one linked audio rendition were selected deterministically.",
          "Segments, codecs, timestamps and playback behavior were not analyzed yet.",
        ]
      : [
          "Only the submitted manifest was collected in this investigation phase.",
          "Segments, codecs, timestamps and playback behavior were not analyzed yet.",
        ],
  };
}

export function buildManifestReport(
  job: ClaimedInvestigationJob,
  evidence: EvidenceBundleV2,
): InvestigationReportContent {
  const rootManifest = evidence.manifests[0]!;
  const selectedVariant = evidence.hls?.selection
    ? evidence.hls.variants.find((variant) => variant.index === evidence.hls?.selection?.variantIndex)
    : undefined;
  return {
    placeholder: false,
    title: `${evidence.source.protocol.toUpperCase()} manifest collected`,
    summary: `${evidence.manifests.length} ${evidence.source.protocol.toUpperCase()} manifest${
      evidence.manifests.length === 1 ? " was" : "s were"
    } fetched through the protected network boundary and preserved as evidence.`,
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
      {
        title: "Current analysis boundary",
        status: "limitation",
        explanation: evidence.limitations.join(" "),
      },
    ],
    confidence: {
      level: "limited",
      explanation: "The manifest format is directly observed, but root-cause confidence requires segment and media evidence.",
    },
    evidence,
    generatedBy: "deterministic-manifest-v2",
  };
}

function toManifestEvidence(promoted: PromotedManifest): ManifestEvidence {
  const inspection = promoted.collected.inspection;
  const hls = inspection.hls;
  return {
    artifactId: promoted.artifactId,
    logicalKey: promoted.collected.logicalKey,
    role: promoted.collected.role,
    requestedUrl: promoted.collected.requestedUrl,
    finalUrl: promoted.collected.finalUrl,
    kind: inspection.kind,
    sizeBytes: promoted.sizeBytes,
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
