import { describe, expect, it } from "vitest";
import { classifyDrmSystemId } from "./isobmff.js";

describe("classifyDrmSystemId", () => {
  it("classifies known DRM system ids", () => {
    expect(classifyDrmSystemId("edef8ba9-79d6-4ace-a3c8-27dcd51d21ed")).toBe("widevine");
    expect(classifyDrmSystemId("9A04F079-9840-4286-AB92-E65BE0885F95")).toBe("playready");
    expect(classifyDrmSystemId("94ce86fb-07ff-4f43-adb8-93d2fa968ca2")).toBe("fairplay");
    expect(classifyDrmSystemId("1077efec-c0b2-4d02-ace3-3c1e52e2fb4b")).toBe("clearkey");
  });

  it("returns unknown for unrecognized system ids", () => {
    expect(classifyDrmSystemId("00000000-0000-0000-0000-000000000000")).toBe("unknown");
    expect(classifyDrmSystemId("")).toBe("unknown");
  });
});
