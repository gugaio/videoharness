import { describe, expect, it } from "vitest";
import { parseReportedContext } from "./reported-context.js";

describe("parseReportedContext", () => {
  it("extracts explicit user clues without turning them into media facts", () => {
    expect(parseReportedContext("A imagem congelou por volta de 01:02:03 quando o ABR caiu de 4K para Full HD; o áudio continuou.")).toEqual({
      approximateTimeSeconds: 3723,
      reportsVideoFreeze: true,
      reportsAudioContinues: true,
      reportsAbrSwitch: true,
      reportsFourKToFullHd: true,
      uncertainties: [],
    });
  });
});
