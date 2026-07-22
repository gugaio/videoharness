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
  });

  it("rejects an invalid port", () => {
    expect(() => loadConfig({ VIDEO_HARNESS_PORT: "70000" })).toThrow();
  });
});
