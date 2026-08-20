import { randomUUID } from "node:crypto";
import { JsonStore } from "../../store/json-file.js";
import type { PlaybackSessionEvidence } from "../domain/evidence.js";

export type PlaybackSession = {
  id: string;
  investigationId: string;
  status: "running" | "completed" | "failed" | "expired";
  requestedDurationMs: number;
  engine?: "hls.js" | "native-hls";
  artifactId?: string;
  createdAt: string;
  finishedAt?: string;
  errorCode?: string;
  errorMessage?: string;
  telemetry?: Omit<PlaybackSessionEvidence, "id">;
};

type StoredSession = PlaybackSession;

type StoredArtifact = {
  id: string;
  logicalKey: string;
  kind: string;
  storageKey: string;
  contentType?: string;
  sizeBytes?: number;
  createdAt: string;
};

export class FilesystemPlaybackSessions {
  constructor(private readonly store: JsonStore) {}

  async create(investigationId: string, requestedDurationMs: number): Promise<PlaybackSession> {
    const session: StoredSession = {
      id: randomUUID(),
      investigationId,
      status: "running",
      requestedDurationMs,
      createdAt: new Date().toISOString(),
    };
    await this.store.appendJsonl(session, "investigations", investigationId, "playback-sessions.jsonl");
    return session;
  }

  async latest(investigationId: string): Promise<PlaybackSession | null> {
    const sessions = await this.store.readJsonl<StoredSession>(
      "investigations", investigationId, "playback-sessions.jsonl",
    );
    const session = sessions.at(-1);
    return session ? { ...session } : null;
  }

  async complete(
    investigationId: string,
    sessionId: string,
    telemetry: Omit<PlaybackSessionEvidence, "id">,
  ): Promise<PlaybackSession | null> {
    const release = await this.store.acquireLock(`locks/investigation-${investigationId}`);
    try {
      const sessions = await this.store.readJsonl<StoredSession>(
        "investigations", investigationId, "playback-sessions.jsonl",
      );
      const session = sessions.find((entry) => entry.id === sessionId && entry.investigationId === investigationId);
      if (!session || session.status !== "running") return null;

      const artifactId = randomUUID();
      const now = new Date().toISOString();
      const artifact: StoredArtifact = {
        id: artifactId,
        logicalKey: `playback/${sessionId}`,
        kind: "playback-telemetry",
        storageKey: `playback/${sessionId}`,
        contentType: "application/json",
        sizeBytes: Buffer.byteLength(JSON.stringify(telemetry)),
        createdAt: now,
      };
      const existing = await this.store.readJson<StoredArtifact[]>(
        "investigations", investigationId, "artifacts.json",
      ) ?? [];
      await this.store.writeJson([...existing.filter((entry) => entry.logicalKey !== artifact.logicalKey), artifact],
        "investigations", investigationId, "artifacts.json");

      const updated: StoredSession = {
        ...session,
        status: "completed",
        engine: telemetry.engine,
        artifactId,
        telemetry,
        finishedAt: now,
      };
      await this.store.writeJson(
        sessions.map((entry) => entry.id === sessionId ? updated : entry),
        "investigations", investigationId, "playback-sessions.jsonl",
      );

      const jobId = randomUUID();
      await this.store.writeJson(
        {
          id: jobId,
          kind: "playback-synthesis",
          investigationId,
          status: "pending",
          attempts: 0,
          maxAttempts: 2,
          payload: { playbackSessionId: sessionId },
          createdAt: now,
        },
        "jobs", "playback-synthesis", `${jobId}.json`,
      );
      await this.store.appendEventUnlocked({
        aggregate: ["investigations", investigationId],
        event: {
          type: "investigation.playback_completed",
          actor: "Browser Playback",
          message: "Browser playback telemetry was recorded; the report is being revised.",
          payload: { sessionId, state: "completed" },
        },
      });
      return updated;
    } finally {
      await release();
    }
  }

  async fail(investigationId: string, sessionId: string, code: string, message: string): Promise<PlaybackSession | null> {
    const release = await this.store.acquireLock(`locks/investigation-${investigationId}`);
    try {
      const sessions = await this.store.readJsonl<StoredSession>(
        "investigations", investigationId, "playback-sessions.jsonl",
      );
      const session = sessions.find((entry) => entry.id === sessionId && entry.investigationId === investigationId);
      if (!session || session.status !== "running") return null;
      const updated: StoredSession = {
        ...session,
        status: "failed",
        errorCode: code,
        errorMessage: message,
        finishedAt: new Date().toISOString(),
      };
      await this.store.writeJson(
        sessions.map((entry) => entry.id === sessionId ? updated : entry),
        "investigations", investigationId, "playback-sessions.jsonl",
      );
      return updated;
    } finally {
      await release();
    }
  }
}