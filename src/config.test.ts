import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("loads safe local defaults", () => {
    const config = loadConfig({});

    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(3210);
    expect(config.workerPollMs).toBe(2_000);
    expect(config.workerLeaseMs).toBe(30_000);
    expect(config.streamTimeoutMs).toBe(25_000);
    expect(config.manifestMaxBytes).toBe(1_048_576);
    expect(config.mediaSampleMode).toBe("full");
    expect(config.mediaSampleMaxSeconds).toBe(60);
    expect(config.mediaSampleMaxTotalBytes).toBe(536_870_912);
    expect(config.recordSegmentMaxBytes).toBe(67_108_864);
    expect(config.recordRequestTimeoutMs).toBe(60_000);
    expect(config.recordMaxVariants).toBe(32);
    expect(config.experimentMaxClonesPerIteration).toBe(4);
    expect(config.experimentMaxIterations).toBe(3);
    expect(config.experimentMaxClonesTotal).toBe(12);
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

  it("loads a configured media sample time budget", () => {
    expect(loadConfig({ VIDEO_HARNESS_MEDIA_SAMPLE_MAX_SECONDS: "120" }).mediaSampleMaxSeconds).toBe(120);
    expect(() => loadConfig({ VIDEO_HARNESS_MEDIA_SAMPLE_MAX_SECONDS: "0" })).toThrow();
  });

  it("validates configurable experiment budgets", () => {
    const config = loadConfig({
      VIDEO_HARNESS_EXPERIMENT_MAX_CLONES_PER_ITERATION: "3",
      VIDEO_HARNESS_EXPERIMENT_MAX_ITERATIONS: "4",
      VIDEO_HARNESS_EXPERIMENT_MAX_CLONES_TOTAL: "10",
    });
    expect(config.experimentMaxClonesPerIteration).toBe(3);
    expect(config.experimentMaxIterations).toBe(4);
    expect(config.experimentMaxClonesTotal).toBe(10);
    expect(() => loadConfig({ VIDEO_HARNESS_EXPERIMENT_MAX_CLONES_PER_ITERATION: "0" })).toThrow();
  });

  it("separates bounded recording downloads from investigation request timeouts", () => {
    const config = loadConfig({ VIDEO_HARNESS_STREAM_TIMEOUT_MS: "25000", VIDEO_HARNESS_RECORD_REQUEST_TIMEOUT_MS: "90000" });
    expect(config.streamTimeoutMs).toBe(25_000);
    expect(config.recordRequestTimeoutMs).toBe(90_000);
    expect(() => loadConfig({ VIDEO_HARNESS_RECORD_REQUEST_TIMEOUT_MS: "121000" })).toThrow();
  });
});
