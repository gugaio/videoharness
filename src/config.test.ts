import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("loads safe local defaults", () => {
    const config = loadConfig({});

    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(3210);
    expect(config.databaseUrl).toContain("video_harness");
    expect(config.workerPollMs).toBe(2_000);
    expect(config.workerLeaseMs).toBe(30_000);
    expect(config.streamTimeoutMs).toBe(25_000);
    expect(config.manifestMaxBytes).toBe(1_048_576);
    expect(config.mediaSampleMode).toBe("full");
    expect(config.recordSegmentMaxBytes).toBe(67_108_864);
    expect(config.recordMaxVariants).toBe(8);
  });

  it("rejects an invalid port", () => {
    expect(() => loadConfig({ VIDEO_HARNESS_PORT: "70000" })).toThrow();
  });

  it("loads a configured media sample mode", () => {
    expect(loadConfig({ VIDEO_HARNESS_MEDIA_SAMPLE_MODE: "sample" }).mediaSampleMode).toBe("sample");
    expect(loadConfig({ VIDEO_HARNESS_MEDIA_SAMPLE_MODE: "full" }).mediaSampleMode).toBe("full");
  });

  it("rejects an invalid media sample mode", () => {
    expect(() => loadConfig({ VIDEO_HARNESS_MEDIA_SAMPLE_MODE: "all" })).toThrow();
  });
});
