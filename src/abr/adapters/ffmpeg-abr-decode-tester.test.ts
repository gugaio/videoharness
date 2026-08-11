import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FfmpegAbrDecodeTester } from "./ffmpeg-abr-decode-tester.js";

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true }))));

describe("FfmpegAbrDecodeTester", () => {
  it("models separate source/target contexts and does not run a forbidden shared-context test", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "abr-decode-test-")); directories.push(directory);
    const results = await new FfmpegAbrDecodeTester({ dataDirectory: directory, binary: "/bin/false", timeoutMs: 1_000 }).run({ switchId: "switch-1", sourceInit: Uint8Array.from([1]), sourceFragments: [Uint8Array.from([2])], targetInit: Uint8Array.from([3]), targetFragments: [Uint8Array.from([4])], bitstreamSwitchingAllowed: false });
    expect(results).toHaveLength(4);
    expect(results.slice(0, 3).every((result) => result.status === "FAIL" && result.exitCode === 1)).toBe(true);
    expect(results[3]).toMatchObject({ test: "SWITCHING_COMPATIBILITY", status: "NOT_RUN" });
    expect(await fs.readdir(path.join(directory, "abr-decode-tests"))).toEqual([]);
  });
});
