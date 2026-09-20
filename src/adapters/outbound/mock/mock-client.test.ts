import { describe, expect, it } from "vitest";
import { MockClient, type MockFetch } from "./mock-client.js";

const OWNER = "owner-1";

function fetchJson(status: number, body: unknown): MockFetch {
  return async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const session = {
  id: "s1",
  workspace_slug: "ws-1",
  stream_id: "od-1",
  cmcd_session_id: "cmcd-1",
  content_id: "cid-1",
  cmcd_version: 1,
  initial_preset: "clean",
  observer_connected: true,
  started_at_ms: 1000,
  last_seen_at_ms: 2000,
  created_at_ms: 1000,
};

const summary = {
  observed_duration_ms: 1000,
  request_count: 1,
  bytes: 10,
  error_count: 0,
  urgent_request_count: 0,
  starvation_count: 0,
  deadline_miss_count: 0,
  intervention_count: 0,
  event_count: 1,
  rebuffer_count: 0,
  rebuffer_duration_ms: 0,
  dropped_frames: 0,
};

describe("MockClient playback timeline", () => {
  it("aceita a projeção do timeline sem cmcd.version e com fatias null do Go", async () => {
    const client = new MockClient(
      "http://mock",
      "http://mock",
      "token",
      fetchJson(200, {
        timeline: {
          session,
          summary,
          entries: [
            {
              kind: "request",
              at_ms: 1000,
              request: {
                request_id: 7,
                started_at_ms: 1000,
                completed_at_ms: 1050,
                duration_ms: 50,
                status: 200,
                bytes: 10,
                kind: "segment",
                target_url: "http://origin/seg0.ts",
                active_preset: "clean",
                cmcd: { valid: true, sid: "cmcd-1", ot: "v", raw_value: "ot=v", canonical_value: "ot=v" },
              },
            },
            {
              kind: "event",
              at_ms: 1100,
              event: { id: "e1", sequence_number: 0, event_type: "playing", wall_time_ms: 1100, monotonic_ms: 100 },
            },
          ],
        },
        findings: [
          {
            rule_id: "rule-a",
            rule_version: 1,
            severity: "info",
            confidence: "low",
            message: "sem medições",
            evidence: null,
            measurements: null,
          },
          {
            rule_id: "rule-b",
            rule_version: 1,
            severity: "warning",
            confidence: "high",
            message: "com medições",
            occurrences: 2,
            evidence: [{ kind: "request", id: "7" }],
            measurements: [{ name: "ratio", value: 2, unit: "ratio" }],
          },
        ],
      }),
    );

    const { timeline, findings } = await client.getPlaybackTimeline(OWNER, "s1");
    expect(timeline.entries).toHaveLength(2);
    const first = timeline.entries[0];
    if (first?.kind !== "request") throw new Error("primeira entry deveria ser request");
    expect(first.request.cmcd?.version).toBeUndefined();
    expect(findings).toHaveLength(2);
    expect(findings[0]?.evidence).toBeUndefined();
    expect(findings[0]?.measurements).toBeUndefined();
    expect(findings[1]?.occurrences).toBe(2);
    expect(findings[1]?.measurements).toEqual([{ name: "ratio", value: 2, unit: "ratio" }]);
  });

  it("normaliza findings null do envelope para lista vazia", async () => {
    const client = new MockClient(
      "http://mock",
      "http://mock",
      "token",
      fetchJson(200, { timeline: { session, summary, entries: [] }, findings: null }),
    );

    const { findings } = await client.getPlaybackTimeline(OWNER, "s1");
    expect(findings).toEqual([]);
  });

  it("mantém o contrato da atividade do workspace com cmcd.version presente", async () => {
    const client = new MockClient(
      "http://mock",
      "http://mock",
      "token",
      fetchJson(200, {
        requests: [
          {
            id: 7,
            workspace_slug: "ws-1",
            stream_id: "od-1",
            kind: "segment",
            target_url: "http://origin/seg0.ts",
            status: 200,
            duration_ms: 50,
            bytes: 10,
            client_ip: "127.0.0.1",
            active_preset: "clean",
            range_result: "not_requested",
            started_at_ms: 1000,
            completed_at_ms: 1050,
            hit_count: 1,
            first_seen_at: "2026-01-01T00:00:00Z",
            last_seen_at: "2026-01-01T00:00:00Z",
            cmcd: { version: 1, valid: true, sid: "cmcd-1" },
          },
        ],
      }),
    );

    const { requests } = await client.listWorkspaceRequests(OWNER, { mode: "proxy" });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.cmcd?.version).toBe(1);
  });
});
