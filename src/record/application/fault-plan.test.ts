import { describe, expect, it } from "vitest";
import { findFaultRule, PlaybackFaultInjector } from "./fault-plan.js";

describe("findFaultRule", () => {
  const plan = { schemaVersion: 1 as const, name: "faults", rules: [
    { id: "truncate-12", when: { resourceKind: "video-segment" as const, targetId: "video-1", mediaSequence: 12 }, action: { type: "truncate_body" as const, keepBytes: 64 } },
  ] };

  it("matches only the registered resource metadata selected by the rule", () => {
    expect(findFaultRule(plan, { kind: "video-segment", targetId: "video-1", mediaSequence: 12 })?.id).toBe("truncate-12");
    expect(findFaultRule(plan, { kind: "video-segment", targetId: "video-1", mediaSequence: 13 })).toBeUndefined();
    expect(findFaultRule(plan, { kind: "audio-segment", targetId: "video-1", mediaSequence: 12 })).toBeUndefined();
  });

  it("applies an intermittent rule on every fourth matching request", () => {
    const injector = new PlaybackFaultInjector();
    const intermittent = { ...plan, rules: [{ ...plan.rules[0]!, everyNthMatch: 4 }] };
    const applied = Array.from({ length: 8 }, () => injector.select("run-1", intermittent, { kind: "video-segment", targetId: "video-1", mediaSequence: 12 })?.matchOrdinal);
    expect(applied).toEqual([undefined, undefined, undefined, 4, undefined, undefined, undefined, 8]);
  });
});
