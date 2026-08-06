import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FilesystemRecordingStore } from "./filesystem-recording-store.js";

const directories: string[] = [];
const recordingId = "c56a4180-65aa-42ec-a945-5fd21dec0538";

afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true }))); });

describe("FilesystemRecordingStore", () => {
  it("publishes a complete private workspace by rename", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "video-harness-recording-"));
    directories.push(directory);
    const store = new FilesystemRecordingStore(directory);
    const workspace = await store.prepareWorkspace(recordingId);
    await fs.writeFile(path.join(workspace.path, "master.m3u8"), "#EXTM3U");

    await store.publish(workspace);

    await expect(fs.readFile(path.join(directory, "recordings", recordingId, "master.m3u8"), "utf8")).resolves.toBe("#EXTM3U");
    await expect(fs.stat(workspace.path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects unsafe recording identifiers", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "video-harness-recording-"));
    directories.push(directory);
    const store = new FilesystemRecordingStore(directory);
    await expect(store.prepareWorkspace("../outside")).rejects.toThrow("Recording ID is invalid");
  });
});
