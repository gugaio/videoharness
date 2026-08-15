import fs from "node:fs/promises";
import path from "node:path";
import type { ManifestCollection } from "../ports/manifest-collector.js";

const SAFE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Materializes a local, URL-free HLS view for the sandboxed shell. */
export class FilesystemLabWorkspace {
  constructor(private readonly dataDirectory: string) {}

  async prepare(investigationId: string, collection: ManifestCollection): Promise<void> {
    if (!SAFE_ID.test(investigationId)) throw new Error("Investigation workspace id is invalid");
    const root = path.join(this.dataDirectory, "workspaces", investigationId, "lab");
    const input = path.join(root, "input");
    const mediaDirectory = path.join(input, "media");
    await fs.rm(root, { recursive: true, force: true });
    await fs.mkdir(mediaDirectory, { recursive: true });
    await fs.mkdir(path.join(root, "work"), { recursive: true });
    const rootManifest = collection.manifests.find((manifest) => manifest.role === "root");
    if (!rootManifest) throw new Error("Lab workspace requires a root manifest");
    const samples = (collection.mediaSamples ?? []).filter((sample) => sample.kind === "media-segment");
    const rootIsMaster = rootManifest.inspection.hls?.kind === "master";
    const selectedIndex = collection.hlsSelection?.variant.index;
    const preferredKey = selectedIndex === undefined ? undefined : `manifest/variant/${selectedIndex}`;
    const sourceKey = preferredKey && samples.some((sample) => sample.sourceManifestLogicalKey === preferredKey)
      ? preferredKey
      : rootIsMaster
        ? samples[0]?.sourceManifestLogicalKey
        : rootManifest.logicalKey;
    const selected = samples
      .filter((sample) => sample.sourceManifestLogicalKey === sourceKey)
      .sort((left, right) => (left.sampleIndex ?? 0) - (right.sampleIndex ?? 0));
    const targetDuration = Math.max(1, Math.ceil(Math.max(...selected.map((sample) => sample.declaredDuration ?? 0), 0)));
    const mediaLines = ["#EXTM3U", "#EXT-X-VERSION:3", `#EXT-X-TARGETDURATION:${targetDuration}`];
    for (const sample of selected) {
      const index = sample.sampleIndex ?? 0;
      const fileName = `segment-${String(index).padStart(6, "0")}.ts`;
      await fs.writeFile(path.join(mediaDirectory, fileName), sample.content.bytes);
      if (sample.declaredDuration !== undefined) mediaLines.push(`#EXTINF:${sample.declaredDuration.toFixed(3)},`);
      mediaLines.push(`media/${fileName}`);
    }
    mediaLines.push("#EXT-X-ENDLIST");
    await fs.writeFile(path.join(input, "index.m3u8"), `${mediaLines.join("\n")}\n`, "utf8");
    await fs.writeFile(path.join(input, "case.json"), JSON.stringify({
      protocol: rootManifest.inspection.protocol,
      manifestLogicalKey: rootManifest.logicalKey,
      sampledSegments: selected.map((sample) => ({ logicalKey: sample.logicalKey, index: sample.sampleIndex, sequence: sample.sequence, duration: sample.declaredDuration })),
    }, null, 2), "utf8");
  }
}
