import { describe, expect, it } from "vitest";
import type { AbrSwitchMatrixEntry, RepresentationSummary } from "../domain/evidence.js";
import { buildAbrSwitchMatrix, reconfigurationSensitivitySummary } from "./switch-matrix.js";

describe("ABR switch matrix", () => {
  it("generates both directions and distinguishes same-resolution switches", () => {
    const representations: RepresentationSummary[] = [
      { evidenceId: "r:4k", id: "2160", periodIndex: 0, adaptationSetIndex: 0, width: 3840, height: 2160, bandwidth: 12_000_000 },
      { evidenceId: "r:fhd-hi", id: "1080-hi", periodIndex: 0, adaptationSetIndex: 0, width: 1920, height: 1080, bandwidth: 5_000_000 },
      { evidenceId: "r:fhd-lo", id: "1080-lo", periodIndex: 0, adaptationSetIndex: 0, width: 1920, height: 1080, bandwidth: 3_000_000 },
    ];
    const matrix = buildAbrSwitchMatrix(representations, []);
    expect(matrix).toHaveLength(6);
    expect(matrix).toContainEqual(expect.objectContaining({ fromRepresentationId: "1080-hi", toRepresentationId: "1080-lo", switchKind: "SAME_RESOLUTION_BITRATE" }));
    expect(matrix).toContainEqual(expect.objectContaining({ fromRepresentationId: "2160", toRepresentationId: "1080-hi", switchKind: "RESOLUTION_CHANGING" }));
  });

  it("highlights the pass-same-resolution/fail-resolution-changing pattern", () => {
    const matrix: AbrSwitchMatrixEntry[] = [
      { fromRepresentationId: "1080-hi", toRepresentationId: "1080-lo", switchKind: "SAME_RESOLUTION_BITRATE", status: "PASS", findingRuleIds: [] },
      { fromRepresentationId: "2160", toRepresentationId: "1080-hi", switchKind: "RESOLUTION_CHANGING", status: "FAIL", findingRuleIds: ["ABR_INIT_001"] },
    ];
    expect(reconfigurationSensitivitySummary(matrix)).toContain("strong evidence of decoder reconfiguration sensitivity");
  });
});
