import { describe, expect, it } from "vitest";
import { CloneSpecSchema, CreateTestEnvironmentRequestSchema, SubmitTestResultRequestSchema } from "./experiment.js";

const investigationId = "c56a4180-65aa-42ec-a945-5fd21dec0538";
const hypothesisId = "8dc67e09-4b25-4fe5-a69a-58f896fb5197";
const reason = { role: "treatment", shortLabel: "TEST", hypothesisIds: [hypothesisId], description: "Change one variable.", expectedDiscriminatingSignal: "Compare with control." };

describe("experiment boundary schemas", () => {
  it("accepts typed HLS and DASH CloneSpecs", () => {
    expect(CloneSpecSchema.safeParse({ version: "1", source: { investigationId, mode: "recorded_snapshot" }, mode: "manifest_only", packaging: { protocol: "hls" }, abr: { mode: "single_representation", representationIds: ["variant-0"] }, reason }).success).toBe(true);
    expect(CloneSpecSchema.safeParse({ version: "1", source: { investigationId, mode: "recorded_snapshot" }, mode: "repackage", packaging: { protocol: "dash", container: "cmaf", segmentDurationSeconds: 4 }, abr: { mode: "single_representation", representationIds: ["video_por=7094000"] }, reason }).success).toBe(true);
  });

  it("accepts serializable audio-only intent while leaving support to the compiler", () => {
    expect(CloneSpecSchema.safeParse({ version: "1", source: { investigationId, mode: "recorded_snapshot" }, mode: "transcode", audio: { codec: "aac", channels: 2, channelLayout: "stereo", sampleRate: 48_000, bitrate: 128_000 }, reason }).success).toBe(true);
  });

  it("rejects invalid ranges, codecs, unsafe identifiers and unsupported manifest-only encoding changes", () => {
    expect(CloneSpecSchema.safeParse({ version: "1", source: { investigationId }, mode: "transcode", video: { codec: "mpeg2", bitrate: 4_000_000 }, reason }).success).toBe(false);
    expect(CloneSpecSchema.safeParse({ version: "1", source: { investigationId }, mode: "transcode", video: { codec: "h264", bitrate: 200_000_000 }, reason }).success).toBe(false);
    expect(CloneSpecSchema.safeParse({ version: "1", source: { investigationId }, mode: "transcode", video: { codec: "h264", width: 12, height: 9 }, reason }).success).toBe(false);
    expect(CloneSpecSchema.safeParse({ version: "1", source: { investigationId }, mode: "manifest_only", audio: { codec: "aac" }, reason }).success).toBe(false);
    expect(CloneSpecSchema.safeParse({ version: "1", source: { investigationId }, mode: "manifest_only", abr: { mode: "single_representation", representationIds: ["v1 && curl bad"] }, reason }).success).toBe(false);
  });

  it("validates TestResult semantics and optional environments", () => {
    const base = { outcome: "FAIL", failureStage: "STARTUP", evidenceArtifactIds: [], reportedBy: "workspace-user", reportedVia: "USER", occurredAt: "2026-08-11T12:00:00.000Z" };
    expect(SubmitTestResultRequestSchema.safeParse(base).success).toBe(true);
    expect(SubmitTestResultRequestSchema.safeParse({ ...base, outcome: "PASS" }).success).toBe(false);
    expect(SubmitTestResultRequestSchema.safeParse({ ...base, testEnvironmentId: "7d9d633e-3118-42e9-a4bb-2d917bbe3290" }).success).toBe(true);
    expect(CreateTestEnvironmentRequestSchema.safeParse({ name: "Samsung lab TV", platform: "Tizen", model: "QN90" }).success).toBe(true);
    expect(CreateTestEnvironmentRequestSchema.safeParse({ name: "" }).success).toBe(false);
  });
});
