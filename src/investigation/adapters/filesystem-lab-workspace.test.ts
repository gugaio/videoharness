import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectManifest } from "../../stream-tools/manifest.js";
import { FilesystemLabWorkspace } from "./filesystem-lab-workspace.js";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true }))); });

describe("FilesystemLabWorkspace", () => {
  it("creates a URL-free local HLS playlist from contiguous media samples", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "video-harness-lab-"));
    directories.push(directory);
    const id = "c56a4180-65aa-42ec-a945-5fd21dec0538";
    const text = "#EXTM3U\n#EXTINF:4,\nfirst.ts\n#EXTINF:4,\nsecond.ts\n#EXT-X-ENDLIST";
    const workspace = new FilesystemLabWorkspace(directory);

    await workspace.prepare(id, {
      manifests: [{
        logicalKey: "manifest/root", role: "root",
        source: { requestedUrl: "https://stream.example/index.m3u8", finalUrl: "https://stream.example/index.m3u8", statusCode: 200 },
        content: { bytes: new TextEncoder().encode(text) }, inspection: inspectManifest(text, "https://stream.example/index.m3u8"),
      }],
      mediaSamples: [
        { logicalKey: "sample/root/media/0", kind: "media-segment", sourceManifestLogicalKey: "manifest/root", sampleIndex: 0, declaredDuration: 4, content: { bytes: new TextEncoder().encode("first") } },
        { logicalKey: "sample/root/media/1", kind: "media-segment", sourceManifestLogicalKey: "manifest/root", sampleIndex: 1, declaredDuration: 4, content: { bytes: new TextEncoder().encode("second") } },
      ],
    });

    const root = path.join(directory, "workspaces", id, "lab", "input");
    await expect(fs.readFile(path.join(root, "media", "segment-000000.ts"), "utf8")).resolves.toBe("first");
    await expect(fs.readFile(path.join(root, "index.m3u8"), "utf8")).resolves.toContain("media/segment-000001.ts");
    await expect(fs.readFile(path.join(root, "index.m3u8"), "utf8")).resolves.toContain("#EXT-X-TARGETDURATION:4");
    await expect(fs.readFile(path.join(root, "index.m3u8"), "utf8")).resolves.not.toContain("https://");
  });
});
