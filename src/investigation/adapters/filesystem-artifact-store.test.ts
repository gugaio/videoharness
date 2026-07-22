import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FilesystemArtifactStore } from "./filesystem-artifact-store.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("FilesystemArtifactStore", () => {
  it("stores and removes an artifact under the isolated investigation directory", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "video-harness-artifacts-"));
    directories.push(directory);
    const store = new FilesystemArtifactStore(directory);

    const stored = await store.put({
      investigationId: "c56a4180-65aa-42ec-a945-5fd21dec0538",
      artifactId: "8dc67e09-4b25-4fe5-a69a-58f896fb5197",
      extension: "m3u8",
      content: new TextEncoder().encode("#EXTM3U"),
    });

    expect(stored).toEqual({
      storageKey: "artifacts/c56a4180-65aa-42ec-a945-5fd21dec0538/8dc67e09-4b25-4fe5-a69a-58f896fb5197.m3u8",
      sizeBytes: 7,
    });
    await expect(fs.readFile(path.join(directory, stored.storageKey), "utf8")).resolves.toBe("#EXTM3U");
    await store.remove(stored.storageKey);
    await expect(fs.stat(path.join(directory, stored.storageKey))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects path traversal storage keys", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "video-harness-artifacts-"));
    directories.push(directory);
    const store = new FilesystemArtifactStore(directory);

    await expect(store.remove("../outside.txt")).rejects.toThrow("storage key is invalid");
  });
});
