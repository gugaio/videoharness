import Fastify, { type FastifyInstance } from "fastify";
import type { HealthResponse } from "../contracts/health.js";
import type { DatabaseHealth } from "../database/client.js";
import type { StartInvestigation } from "../investigation/application/start-investigation.js";
import type { InvestigationQueries } from "../investigation/application/investigation-queries.js";
import type { PostgresPlaybackSessions } from "../investigation/adapters/postgres-playback-session.js";
import { ApiError } from "./errors.js";
import { registerInvestigationRoutes } from "./routes/investigations.js";

export type ApiServerDependencies = {
  database: DatabaseHealth;
  startInvestigation: StartInvestigation;
  investigationQueries: InvestigationQueries;
  playbackSessions?: PostgresPlaybackSessions;
  version?: string;
};

export function buildApiServer(dependencies: ApiServerDependencies): FastifyInstance {
  const server = Fastify({
    logger: false,
  });

  server.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send({
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          requestId: request.id,
        },
      });
    }
    request.log.error(error);
    return reply.status(500).send({
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred",
        requestId: request.id,
      },
    });
  });

  server.get("/v1/health", async (_request, reply): Promise<HealthResponse> => {
    let databaseStatus: "up" | "down" = "up";
    try {
      await dependencies.database.check();
    } catch {
      databaseStatus = "down";
      void reply.status(503);
    }

    return {
      ok: databaseStatus === "up",
      service: "video-harness-api",
      version: dependencies.version ?? "0.1.0",
      now: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      database: { status: databaseStatus },
    };
  });

  registerInvestigationRoutes(server, {
    startInvestigation: dependencies.startInvestigation,
    queries: dependencies.investigationQueries,
    ...(dependencies.playbackSessions ? { playbackSessions: dependencies.playbackSessions } : {}),
  });

  return server;
}
