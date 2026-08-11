import { describe, expect, it } from "vitest";
import { parseReportedContext } from "./parse-reported-context.js";

describe("parseReportedContext", () => {
  it("extracts explicit user clues without turning them into media facts", () => {
    expect(parseReportedContext("A imagem congelou por volta de 01:02:03 quando o ABR caiu de 4K para Full HD; o áudio continuou.")).toEqual({
      approximateTimeSeconds: 3723, reportsVideoFreeze: true, reportsAudioContinues: true, reportsAbrSwitch: true,
      reportedAbrDirection: "DOWNSHIFT", reportedResolutionTransition: { sourceHeight: 2160, targetHeight: 1080 }, mentionedPlayerEvents: [],
      descriptionExcerpt: "A imagem congelou por volta de 01:02:03 quando o ABR caiu de 4K para Full HD; o áudio continuou.", uncertainties: [],
    });
  });

  it("keeps platform details as reported context, not observed device telemetry", () => {
    expect(parseReportedContext("TV: QN90B firmware: 1622.4 Tizen 7.0; app version: 4.2.1; AVPlay version: 7.0; DRM: PlayReady; HDR mode: HDR10; PLAYER_MSG_RESOLUTION_CHANGED then onbufferingstart")).toMatchObject({
      reportedDevice: { modelCode: "QN90B", firmwareVersion: "1622.4", operatingSystem: "Tizen", operatingSystemVersion: "7.0", applicationVersion: "4.2.1", playerName: "AVPlay", playerVersion: "7.0", drmSystem: "PlayReady", displayOrHdrMode: "HDR10" },
      mentionedPlayerEvents: ["PLAYER_MSG_RESOLUTION_CHANGED", "onbufferingstart"],
    });
  });

  it("recognizes protocol-independent quality changes", () => {
    expect(parseReportedContext("hls.js LEVEL_SWITCHED during an upshift from 720p to 1080p")).toMatchObject({
      reportsAbrSwitch: true, reportedAbrDirection: "UPSHIFT", reportedResolutionTransition: { sourceHeight: 720, targetHeight: 1080 },
      reportedDevice: { playerName: "hls.js" }, mentionedPlayerEvents: ["LEVEL_SWITCHED"],
    });
  });
});
