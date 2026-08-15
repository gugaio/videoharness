import { describe, expect, it } from "vitest";
import { projectDecoderCapability } from "./project-decoder-capability.js";

describe("projectDecoderCapability", () => {
  it("parses HEVC levels and profiles from codec descriptors", () => {
    const result = projectDecoderCapability([
      { evidenceId: "r:1", id: "uhd", groupId: "dash:video", codecs: "hvc1.1.6.L153.B0", width: 3840, height: 2160 },
      { evidenceId: "r:2", id: "fhd", groupId: "dash:video", codecs: "hvc1.1.6.L123.B0", width: 1920, height: 1080 },
    ]);

    expect(result.codecFamily).toBe("HEVC");
    expect(result.profiles).toEqual(["Main"]);
    expect(result.maxRequiredLevelNumeric).toBeCloseTo(5.1);
    expect(result.maxRequiredLevel).toBe("Level 5.1");
    expect(result.maxResolution).toEqual({ width: 3840, height: 2160 });
    expect(result.representations[0]).toMatchObject({ requiredProfile: "Main", requiredLevel: "L153" });
  });

  it("parses AVC profiles and levels", () => {
    const result = projectDecoderCapability([
      { evidenceId: "r:1", id: "v1", groupId: "hls:video", codecs: "avc1.640028", width: 1920, height: 1080 },
    ]);

    expect(result.codecFamily).toBe("H264");
    expect(result.maxRequiredLevelNumeric).toBeCloseTo(4.0);
    expect(result.maxRequiredLevel).toBe("Level 4.0");
    expect(result.representations[0]?.requiredProfile).toBe("High");
  });

  it("defaults to UNKNOWN for empty or unrecognized ladders", () => {
    expect(projectDecoderCapability([]).codecFamily).toBe("UNKNOWN");
    expect(projectDecoderCapability([{ evidenceId: "r:1", id: "a", groupId: "x" }]).codecFamily).toBe("UNKNOWN");
  });
});
