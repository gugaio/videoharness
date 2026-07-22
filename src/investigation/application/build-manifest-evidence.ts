import type { EvidenceBundleV2, ManifestEvidence } from "../domain/evidence.js";
import type { ClaimedInvestigationJob } from "../domain/investigation-job.js";
import type { InvestigationReportContent } from "../domain/investigation-report.js";
import type {
  Manifest,
  ManifestCollection,
} from "../ports/manifest-collector.js";

export function buildManifestEvidence(collection: ManifestCollection): EvidenceBundleV2 {
  const root = collection.manifests.find((manifest) => manifest.role === "root");
  if (!root) throw new Error("Manifest collection has no root manifest");
  requireArtifact(root);
  const rootHls = root.inspection.hls;
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
    mediaSamples: [],
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
    limitations: root.inspection.protocol === "hls" && root.inspection.kind === "master"
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
