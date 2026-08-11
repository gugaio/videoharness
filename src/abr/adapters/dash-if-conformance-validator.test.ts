import { describe, expect, it } from "vitest";
import { mapDashIfConformanceOutput } from "./dash-if-conformance-validator.js";

describe("DASH-IF conformance evidence mapping", () => {
  it("keeps the validator as a second opinion and maps scopes to VHS evidence IDs", () => {
    const result = mapDashIfConformanceOutput("switch-1", { validator: "DASH-IF v2", findings: [{ code: "SAP", severity: "error", scope: "video-1/12.m4s", message: "SAP mismatch" }] }, new Map([["video-1/12.m4s", "boundary:target"]]));
    expect(result.summary).toMatchObject({ status: "FAIL", validator: "DASH-IF v2", findingEvidenceIds: ["dash-if:switch-1:1"] });
    expect(result.findings[0]).toMatchObject({ code: "SAP", relatedEvidenceIds: ["boundary:target"] });
  });
});
