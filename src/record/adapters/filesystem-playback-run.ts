import { randomUUID } from "node:crypto";
import { JsonStore } from "../../store/json-file.js";
import { type FaultPlan, type NetworkProfile, type PlaybackRun } from "../domain/playback-run.js";
import type { CreatedPlaybackRun, DeliveryRequest, PlaybackRunRepository, RecordedDiagnosticResource } from "../ports/playback-run.js";
import type { RecordedResource } from "../domain/recorded-resource.js";
import type { StoredRecording } from "./filesystem-recording-intake.js";

type StoredRun = PlaybackRun;

type StoredDelivery = Omit<DeliveryRequest, "completedAt"> & { recordedAt: string };

export class FilesystemPlaybackRuns implements PlaybackRunRepository {
  constructor(private readonly store: JsonStore) {}

  async create(recordingId: string, maxDurationSeconds: number, profile: NetworkProfile, faultPlan?: FaultPlan): Promise<CreatedPlaybackRun | "recording_not_ready"> {
    const recording = await this.store.readJson<StoredRecording>("recordings", recordingId, "recording.json");
    if (!recording || recording.state !== "ready") return "recording_not_ready";
    const now = new Date();
    const run: StoredRun = {
      id: randomUUID(),
      recordingId,
      state: "created",
      maxDurationSeconds,
      profile,
      ...(faultPlan ? { faultPlan } : {}),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    };
    await this.store.writeJson(run, "runs", `${run.id}.json`);
    return { run, manifestPath: recording.protocol === "dash" ? "index.mpd" : "index.m3u8" };
  }

  async findById(recordingId: string, runId: string): Promise<PlaybackRun | null> {
    const run = await this.readRun(runId);
    return run && run.recordingId === recordingId ? { ...run } : null;
  }

  async findLatestOpen(recordingId: string): Promise<PlaybackRun | null> {
    const runIds = await this.store.listFiles("runs");
    const now = Date.now();
    let latest: StoredRun | null = null;
    for (const file of runIds) {
      if (!file.endsWith(".json")) continue;
      const run = await this.readRun(file.slice(0, -5));
      if (!run || run.recordingId !== recordingId) continue;
      if (run.state === "created" || run.state === "active") {
        if (new Date(run.expiresAt).getTime() <= now) {
          await this.updateRun(run.id, { ...run, state: "expired" });
          continue;
        }
        if (!latest || run.createdAt.localeCompare(latest.createdAt) > 0) latest = run;
      }
    }
    return latest ? { ...latest } : null;
  }

  async finish(recordingId: string, runId: string): Promise<PlaybackRun | null> {
    const run = await this.readRun(runId);
    if (!run || run.recordingId !== recordingId || (run.state !== "created" && run.state !== "active")) return null;
    const updated: StoredRun = { ...run, state: "completed", completedAt: new Date().toISOString() };
    await this.updateRun(runId, updated);
    return { ...updated };
  }

  async recordDelivery(input: Omit<DeliveryRequest, "id" | "completedAt"> & { runId: string }): Promise<void> {
    const delivery: StoredDelivery = {
      id: randomUUID(),
      logicalPath: input.logicalPath,
      resourceKind: input.resourceKind,
      ...(input.targetId ? { targetId: input.targetId } : {}),
      ...(input.mediaSequence === undefined ? {} : { mediaSequence: input.mediaSequence }),
      stageIndex: input.stageIndex,
      bandwidthKbps: input.bandwidthKbps,
      latencyMs: input.latencyMs,
      bytesSent: input.bytesSent,
      statusCode: input.statusCode,
      startedAt: input.startedAt,
      ...(input.faultRuleId ? { faultRuleId: input.faultRuleId } : {}),
      ...(input.faultAction ? { faultAction: input.faultAction } : {}),
      recordedAt: new Date().toISOString(),
    };
    await this.store.appendJsonl(delivery, "deliveries", `${input.runId}.jsonl`);
  }

  async listDeliveries(recordingId: string, runId: string, limit: number): Promise<DeliveryRequest[]> {
    const resources = await this.store.readJson<RecordedResource[]>("recordings", recordingId, "resources.json") ?? [];
    const byPath = new Map(resources.map((resource) => [resource.logicalPath, resource]));
    const deliveries = await this.store.readJsonl<StoredDelivery>("deliveries", `${runId}.jsonl`);
    return deliveries
      .sort((left, right) => right.recordedAt.localeCompare(left.recordedAt) || right.id.localeCompare(left.id))
      .slice(0, limit)
      .map((row) => {
        const resource = byPath.get(row.logicalPath);
        return {
          id: row.id,
          logicalPath: row.logicalPath,
          resourceKind: row.resourceKind,
          ...(row.targetId ? { targetId: row.targetId } : {}),
          ...(row.mediaSequence === undefined ? {} : { mediaSequence: row.mediaSequence }),
          ...(typeof resource?.metadata?.bandwidth === "number" ? { variantBandwidth: resource.metadata.bandwidth } : {}),
          ...(typeof resource?.metadata?.resolution === "string" ? { variantResolution: resource.metadata.resolution } : {}),
          stageIndex: row.stageIndex,
          bandwidthKbps: row.bandwidthKbps,
          latencyMs: row.latencyMs,
          bytesSent: row.bytesSent,
          statusCode: row.statusCode,
          startedAt: row.startedAt,
          completedAt: row.recordedAt,
          ...(row.faultRuleId ? { faultRuleId: row.faultRuleId } : {}),
          ...(row.faultAction ? { faultAction: row.faultAction } : {}),
        };
      });
  }

  async listDiagnosticResources(recordingId: string): Promise<RecordedDiagnosticResource[]> {
    const resources = await this.store.readJson<RecordedResource[]>("recordings", recordingId, "resources.json") ?? [];
    return resources
      .slice()
      .sort((left, right) => left.logicalPath.localeCompare(right.logicalPath))
      .map((resource) => ({
        logicalPath: resource.logicalPath,
        resourceKind: resource.kind,
        sizeBytes: resource.sizeBytes,
        sha256: resource.sha256,
        metadata: resource.metadata,
      }));
  }

  private async readRun(runId: string): Promise<StoredRun | null> {
    return this.store.readJson<StoredRun>("runs", `${runId}.json`);
  }

  private async updateRun(runId: string, run: StoredRun): Promise<void> {
    await this.store.writeJson(run, "runs", `${runId}.json`);
  }
}